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


def _host_fingerprint(row: HostSession) -> str:
    """Best-effort identity used to collapse duplicate rows for the same machine install."""
    platform = (row.platform or "").strip().lower()
    device_name = (row.device_name or "").strip().lower()

    # Deliberately ignore port/script state so the same desktop install collapses
    # even if status fields vary between heartbeats.
    return f"{platform}|{device_name}"


def _dedupe_rows(rows: list[HostSession]) -> list[HostSession]:
    """Keep only newest row per machine fingerprint to hide/repair historic duplicates."""
    by_fp: Dict[str, HostSession] = {}
    for r in rows:
        fp = _host_fingerprint(r)
        prev = by_fp.get(fp)
        if prev is None or (r.last_seen_at_ms or 0) > (prev.last_seen_at_ms or 0):
            by_fp[fp] = r

    return sorted(by_fp.values(), key=lambda r: r.last_seen_at_ms or 0, reverse=True)


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

        # Best-effort cleanup pass: when duplicates exist for same machine fingerprint,
        # keep newest and remove older rows immediately.
        deduped = _dedupe_rows(rows)
        keep_ids = {r.id for r in deduped}
        deleted_any = False
        for r in rows:
            if r.id not in keep_ids:
                db.delete(r)
                deleted_any = True
        if deleted_any:
            try:
                db.commit()
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
                deduped = _dedupe_rows(rows)
            except Exception:
                db.rollback()

        hosts = []
        for r in deduped:
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

            # Best-effort cleanup: remove stale duplicates for same machine fingerprint
            # when host_session_id changed across app runs.
            try:
                all_rows = (
                    db.execute(
                        select(HostSession)
                        .where(HostSession.firebase_uid == ident.uid)
                        .where(HostSession.platform == platform_s)
                        .where(HostSession.device_name == device_name_s)
                    )
                    .scalars()
                    .all()
                )
                keep = _dedupe_rows(all_rows)
                keep_ids = {k.id for k in keep}
                for r in all_rows:
                    if r.id not in keep_ids:
                        db.delete(r)
            except Exception:
                pass

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
