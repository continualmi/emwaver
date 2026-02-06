from __future__ import annotations

import json
import time
from dataclasses import dataclass
from typing import Any, Dict, Optional

from emw_backend.db import SessionLocal
from emw_backend.models import HostSession
from emw_backend.routes.ws import _router  # in-process router (single-worker assumption)


@dataclass
class ToolError(Exception):
    message: str


def hosts_list(*, uid: str) -> Dict[str, Any]:
    now = int(time.time() * 1000)
    with SessionLocal() as db:
        rows = (
            db.query(HostSession)
            .filter(HostSession.firebase_uid == uid)
            .order_by(HostSession.last_seen_at_ms.desc())
            .limit(200)
            .all()
        )

    hosts = []
    for r in rows:
        try:
            caps = json.loads(r.capabilities_json or "{}")
        except Exception:
            caps = {}
        try:
            status = json.loads(r.status_json or "{}")
        except Exception:
            status = {}

        hosts.append(
            {
                "id": r.id,
                "platform": r.platform,
                "device_name": r.device_name,
                "app_version": r.app_version,
                "capabilities": caps,
                "status": status,
                "created_at_ms": r.created_at_ms,
                "last_seen_at_ms": r.last_seen_at_ms,
                "online": (now - (r.last_seen_at_ms or 0)) < 30_000,
            }
        )

    return {"hosts": hosts, "now_ms": now}


def remote_attach(*, uid: str, hostSessionId: str) -> Dict[str, Any]:
    # v1: best-effort. Forward attach to host.
    ok = _router.forward_to_host(uid=uid, host_session_id=hostSessionId, msg={"type": "host.attach", "hostSessionId": hostSessionId})
    if not ok:
        raise ToolError("host_offline")
    return {"attached": True, "hostSessionId": hostSessionId}


def remote_run_script(*, uid: str, hostSessionId: str, name: str, source: str) -> Dict[str, Any]:
    ok = _router.forward_to_host(
        uid=uid,
        host_session_id=hostSessionId,
        msg={"type": "script.run", "hostSessionId": hostSessionId, "name": name, "source": source},
    )
    if not ok:
        raise ToolError("host_offline")
    # scriptInstanceId will arrive asynchronously via script.started; callers should waitForUi / waitForScriptStarted.
    return {"sent": True}


def remote_wait_for_ui(*, uid: str, hostSessionId: str, minRev: int = 0, timeoutSeconds: float = 10.0) -> Dict[str, Any]:
    snap = _router.wait_for_ui_snapshot(uid, hostSessionId, min_rev=int(minRev or 0), timeout_s=float(timeoutSeconds or 10.0))
    if snap is None:
        return {"timeout": True}
    return {"snapshot": snap}


def remote_send_ui_event(
    *,
    uid: str,
    hostSessionId: str,
    scriptInstanceId: str,
    targetNodeId: str,
    name: str,
    payload: Optional[Dict[str, Any]] = None,
    baseRev: Optional[int] = None,
) -> Dict[str, Any]:
    msg: Dict[str, Any] = {
        "type": "ui.event",
        "hostSessionId": hostSessionId,
        "scriptInstanceId": scriptInstanceId,
        "targetNodeId": targetNodeId,
        "name": name,
        "payload": payload or {},
    }
    if baseRev is not None:
        msg["baseRev"] = int(baseRev)

    ok = _router.forward_to_host(uid=uid, host_session_id=hostSessionId, msg=msg)
    if not ok:
        raise ToolError("host_offline")
    return {"sent": True}
