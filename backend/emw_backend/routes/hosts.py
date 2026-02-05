from __future__ import annotations

import json
import time
from typing import Any, Dict, Optional

from flask import Blueprint, current_app, jsonify, request
from sqlalchemy import desc, select

from emw_backend.auth import verify_request_identity
from emw_backend.config import Config
from emw_backend.db import SessionLocal
from emw_backend.models import HostSession


hosts_bp = Blueprint("hosts", __name__)


def _now_ms() -> int:
    return int(time.time() * 1000)


def _require_identity(config: Config):
    ident = verify_request_identity(request, config)
    if not ident:
        return None, (jsonify({"error": "Unauthorized"}), 401)
    return ident, None


@hosts_bp.get("/v1/hosts")
def list_hosts():
    """List host sessions for the authenticated user only."""

    config: Config = current_app.config["EMWAVER_CONFIG"]
    ident, err = _require_identity(config)
    if err:
        return err

    now = _now_ms()

    with SessionLocal() as db:
        rows = (
            db.execute(
                select(HostSession)
                .where(HostSession.firebase_uid == ident.uid)
                .order_by(desc(HostSession.last_seen_at_ms))
                .limit(200)
            )
            .scalars()
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

    return jsonify({"hosts": hosts, "now_ms": now})


@hosts_bp.post("/v1/hosts/heartbeat")
def heartbeat():
    """Upsert a host session heartbeat for the authenticated user only."""

    config: Config = current_app.config["EMWAVER_CONFIG"]
    ident, err = _require_identity(config)
    if err:
        return err

    payload = request.get_json(force=True, silent=True) or {}
    if not isinstance(payload, dict):
        return jsonify({"error": "Invalid JSON payload"}), 400

    host_id = payload.get("host_session_id") or payload.get("id")
    if not isinstance(host_id, str) or not host_id.strip():
        return jsonify({"error": "Missing 'host_session_id'"}), 400
    host_id = host_id.strip()

    platform = payload.get("platform")
    device_name = payload.get("device_name")
    app_version = payload.get("app_version")
    capabilities = payload.get("capabilities")
    status = payload.get("status")

    def _opt_str(v: Any, default: str = "") -> str:
        if not isinstance(v, str):
            return default
        return v.strip()

    platform_s = _opt_str(platform, "unknown")
    device_name_s = _opt_str(device_name, "")
    app_version_s = _opt_str(app_version, "")

    if capabilities is None:
        capabilities = {}
    if status is None:
        status = {}
    if not isinstance(capabilities, dict):
        return jsonify({"error": "Invalid 'capabilities'"}), 400
    if not isinstance(status, dict):
        return jsonify({"error": "Invalid 'status'"}), 400

    now = _now_ms()

    with SessionLocal() as db:
        row: Optional[HostSession] = db.get(HostSession, host_id)
        if row is None:
            row = HostSession(
                id=host_id,
                firebase_uid=ident.uid,
                platform=platform_s,
                device_name=device_name_s,
                app_version=app_version_s,
                capabilities_json=json.dumps(capabilities, ensure_ascii=False),
                status_json=json.dumps(status, ensure_ascii=False),
                created_at_ms=now,
                last_seen_at_ms=now,
            )
            db.add(row)
            db.commit()
            return jsonify({"ok": True, "created": True, "server_time_ms": now})

        # Enforce ownership (only same user can update)
        if row.firebase_uid != ident.uid:
            return jsonify({"error": "Not found"}), 404

        row.platform = platform_s or row.platform
        row.device_name = device_name_s
        row.app_version = app_version_s
        row.capabilities_json = json.dumps(capabilities, ensure_ascii=False)
        row.status_json = json.dumps(status, ensure_ascii=False)
        row.last_seen_at_ms = now

        db.add(row)
        db.commit()

    return jsonify({"ok": True, "created": False, "server_time_ms": now})
