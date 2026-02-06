from __future__ import annotations

import json
import threading
import time
# (no dataclasses)
from typing import Any, Dict, Optional, Set

from flask import current_app, request
from flask_sock import Sock

from emw_backend.auth import VerifiedIdentity
from emw_backend.config import Config
from emw_backend.db import SessionLocal
from emw_backend.models import HostSession


sock = Sock()


def _json_send(ws, obj: Any) -> None:
    ws.send(json.dumps(obj, ensure_ascii=False))


def _json_recv(ws) -> Optional[Dict[str, Any]]:
    raw = ws.receive()
    if raw is None:
        return None
    try:
        obj = json.loads(raw)
    except Exception:
        return {"type": "error", "error": "invalid_json"}
    if not isinstance(obj, dict):
        return {"type": "error", "error": "invalid_message"}
    return obj


def _bearer_or_query_token() -> str:
    # Browser WebSocket API cannot set Authorization headers, so we allow ?token=.
    raw = (request.headers.get("Authorization", "") or "").strip()
    if raw.lower().startswith("bearer "):
        return raw[len("bearer ") :].strip()
    return (request.args.get("token") or "").strip()


def verify_ws_identity(config: Config) -> Optional[VerifiedIdentity]:
    # Dev escape hatch.
    if config.auth_mode == "disabled":
        return VerifiedIdentity(uid="dev-user", email=None, display_name="Dev User")

    token = _bearer_or_query_token()
    if not token:
        return None

    if not config.firebase_project_id:
        return None

    # Import here to avoid adding deps to callers.
    from google.auth.transport import requests as google_requests
    from google.oauth2 import id_token

    try:
        info = id_token.verify_firebase_token(
            token,
            google_requests.Request(),
            audience=config.firebase_project_id,
        )
    except Exception:
        return None

    uid = info.get("uid") or info.get("sub")
    if not uid:
        return None

    return VerifiedIdentity(
        uid=str(uid),
        email=info.get("email"),
        display_name=info.get("name"),
    )


class _Conn:
    """A single WS connection.

    NOTE: Instances must be hashable because we store them in sets/maps.
    We intentionally hash by a stable per-connection id, not by the underlying
    ws object (which may not be hashable).
    """

    def __init__(self, *, ws: Any, uid: str, role: str, host_session_id: Optional[str] = None):
        self.ws = ws
        self.uid = uid
        self.role = role  # 'host' | 'web'
        self.host_session_id = host_session_id
        self.conn_id = id(ws)

    def __hash__(self) -> int:  # allow use in set/dict
        return int(self.conn_id)

    def __eq__(self, other: object) -> bool:
        return isinstance(other, _Conn) and self.conn_id == other.conn_id


class RemoteSessionRouter:
    def __init__(self):
        self._lock = threading.Lock()
        self._hosts: Dict[str, Dict[str, _Conn]] = {}  # uid -> host_session_id -> conn
        self._webs: Dict[str, Set[_Conn]] = {}  # uid -> conns
        self._subs: Dict[_Conn, Set[str]] = {}  # web conn -> host_session_ids

        # Best-effort observability for non-WS controllers (e.g. backend agent tools).
        # Single-worker assumption: this lives in memory only.
        self._latest_script_started: Dict[tuple[str, str], Dict[str, Any]] = {}  # (uid,hid) -> msg
        self._latest_ui_snapshot: Dict[tuple[str, str], Dict[str, Any]] = {}  # (uid,hid) -> msg
        self._cond = threading.Condition(self._lock)

    def register_host(self, c: _Conn) -> None:
        assert c.host_session_id
        with self._lock:
            self._hosts.setdefault(c.uid, {})[c.host_session_id] = c

    def unregister(self, c: _Conn) -> None:
        with self._lock:
            if c.role == "host" and c.host_session_id:
                m = self._hosts.get(c.uid)
                if m and m.get(c.host_session_id) is c:
                    del m[c.host_session_id]
            if c.role == "web":
                s = self._webs.get(c.uid)
                if s and c in s:
                    s.remove(c)
                self._subs.pop(c, None)

    def register_web(self, c: _Conn) -> None:
        with self._lock:
            self._webs.setdefault(c.uid, set()).add(c)
            self._subs.setdefault(c, set())

    def subscribe(self, web: _Conn, host_session_id: str) -> None:
        with self._lock:
            self._subs.setdefault(web, set()).add(host_session_id)

    def forward_to_host(self, uid: str, host_session_id: str, msg: Dict[str, Any]) -> bool:
        with self._lock:
            host = self._hosts.get(uid, {}).get(host_session_id)
        if not host:
            return False
        try:
            _json_send(host.ws, msg)
            return True
        except Exception:
            return False

    def forward_to_web_subscribers(self, uid: str, host_session_id: str, msg: Dict[str, Any]) -> None:
        # Record best-effort latest state for agent tools.
        with self._lock:
            k = (uid, host_session_id)
            mtype = str(msg.get("type") or "")
            if mtype == "script.started":
                self._latest_script_started[k] = dict(msg)
                self._cond.notify_all()
            if mtype == "ui.snapshot":
                self._latest_ui_snapshot[k] = dict(msg)
                self._cond.notify_all()

            webs = list(self._webs.get(uid, set()))
            subs_map = {w: set(self._subs.get(w, set())) for w in webs}

        for w in webs:
            if host_session_id not in subs_map.get(w, set()):
                continue
            try:
                _json_send(w.ws, msg)
            except Exception:
                # Connection cleanup happens on disconnect.
                pass

    def get_latest_script_started(self, uid: str, host_session_id: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            return self._latest_script_started.get((uid, host_session_id))

    def get_latest_ui_snapshot(self, uid: str, host_session_id: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            return self._latest_ui_snapshot.get((uid, host_session_id))

    def wait_for_ui_snapshot(self, uid: str, host_session_id: str, *, min_rev: int = 0, timeout_s: float = 10.0) -> Optional[Dict[str, Any]]:
        deadline = time.time() + float(timeout_s)
        with self._lock:
            while True:
                snap = self._latest_ui_snapshot.get((uid, host_session_id))
                if snap is not None:
                    try:
                        rev = int(snap.get("rev") or 0)
                    except Exception:
                        rev = 0
                    if rev >= int(min_rev):
                        return dict(snap)

                remaining = deadline - time.time()
                if remaining <= 0:
                    return None
                self._cond.wait(timeout=remaining)


_router = RemoteSessionRouter()


def init_ws(app) -> None:
    sock.init_app(app)


@sock.route("/v1/ws")
def ws_handler(ws):
    config: Config = current_app.config["EMWAVER_CONFIG"]
    ident = verify_ws_identity(config)
    if not ident:
        try:
            _json_send(ws, {"type": "error", "error": "unauthorized"})
        except Exception:
            pass
        return

    # Expect first message to be hello.
    hello = _json_recv(ws)
    if not hello or hello.get("type") != "hello":
        _json_send(ws, {"type": "error", "error": "expected_hello"})
        return

    role = str(hello.get("role") or "").strip().lower()
    host_session_id = str(hello.get("hostSessionId") or "").strip() or None

    if role not in ("host", "web"):
        _json_send(ws, {"type": "error", "error": "invalid_role"})
        return

    conn = _Conn(ws=ws, uid=ident.uid, role=role, host_session_id=host_session_id)

    if role == "host":
        if not host_session_id:
            _json_send(ws, {"type": "error", "error": "missing_hostSessionId"})
            return

        # Require that this host_session_id belongs to the user (was heartbeated).
        with SessionLocal() as db:
            row: Optional[HostSession] = db.get(HostSession, host_session_id)
            if not row or row.firebase_uid != ident.uid:
                _json_send(ws, {"type": "error", "error": "unknown_hostSessionId"})
                return

        _router.register_host(conn)
        _json_send(ws, {"type": "hello.ack", "role": "host", "hostSessionId": host_session_id})

    else:
        _router.register_web(conn)
        _json_send(ws, {"type": "hello.ack", "role": "web"})

    try:
        while True:
            msg = _json_recv(ws)
            if msg is None:
                break

            mtype = str(msg.get("type") or "")

            # Web -> Host routing
            if conn.role == "web":
                if mtype == "host.attach":
                    hid = str(msg.get("hostSessionId") or "").strip()
                    if not hid:
                        _json_send(ws, {"type": "host.error", "error": "missing_hostSessionId"})
                        continue

                    # Subscribe web to this host's outbound stream.
                    _router.subscribe(conn, hid)

                    ok = _router.forward_to_host(
                        uid=conn.uid,
                        host_session_id=hid,
                        msg={"type": "host.attach", "hostSessionId": hid},
                    )
                    if not ok:
                        _json_send(ws, {"type": "host.error", "hostSessionId": hid, "error": "host_offline"})
                    else:
                        _json_send(ws, {"type": "host.attached", "hostSessionId": hid})
                    continue

                # Forward any other message to the specified host.
                hid = str(msg.get("hostSessionId") or "").strip()
                if not hid:
                    _json_send(ws, {"type": "error", "error": "missing_hostSessionId"})
                    continue

                ok = _router.forward_to_host(uid=conn.uid, host_session_id=hid, msg=msg)
                if not ok:
                    _json_send(ws, {"type": "error", "error": "host_offline", "hostSessionId": hid})
                continue

            # Host -> Web routing
            if conn.role == "host":
                # Ensure hostSessionId is always present on outbound frames.
                msg.setdefault("hostSessionId", conn.host_session_id)
                _router.forward_to_web_subscribers(conn.uid, conn.host_session_id or "", msg)
                continue

    finally:
        _router.unregister(conn)
