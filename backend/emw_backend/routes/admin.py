from __future__ import annotations

import time
from typing import Optional

from flask import Blueprint, current_app, jsonify, request

from emw_backend.auth import verify_request_identity
from emw_backend.config import Config
from emw_backend.db import SessionLocal
from emw_backend.models import UserEntitlement


admin_bp = Blueprint("admin", __name__)


def _now_ms() -> int:
    return int(time.time() * 1000)


def _require_admin(config: Config):
    ident = verify_request_identity(request, config)
    if not ident:
        return None, (jsonify({"error": "Unauthorized"}), 401)

    allowed_uid = (config.provisioning_allowed_uids or [])
    allowed_email = (config.provisioning_allowed_email or "").strip().lower()

    is_admin = False
    if ident.uid and ident.uid in allowed_uid:
        is_admin = True
    if ident.email and allowed_email and ident.email.strip().lower() == allowed_email:
        is_admin = True

    if not is_admin:
        return None, (jsonify({"error": "Forbidden"}), 403)

    return ident, None


@admin_bp.post("/v1/admin/grant_pro")
def grant_pro():
    """Admin-only: grant EMWaver Pro to a firebase uid.

    Guarded by:
    - EMWAVER_PROVISIONING_ALLOWED_UIDS (preferred)
    - EMWAVER_PROVISIONING_ALLOWED_EMAIL (fallback)

    Payload:
      { "uid": "...", "expires_at_ms": 123 | null }

    If expires_at_ms is null/omitted, Pro is granted without expiry.
    """

    config: Config = current_app.config["EMWAVER_CONFIG"]
    _admin, err = _require_admin(config)
    if err:
        return err

    payload = request.get_json(force=True, silent=True) or {}
    if not isinstance(payload, dict):
        return jsonify({"error": "Invalid JSON"}), 400

    uid = payload.get("uid")
    if not isinstance(uid, str) or not uid.strip():
        return jsonify({"error": "Missing uid"}), 400
    uid = uid.strip()

    expires_at_ms = payload.get("expires_at_ms")
    if expires_at_ms is not None:
        try:
            expires_at_ms = int(expires_at_ms)
        except Exception:
            return jsonify({"error": "Invalid expires_at_ms"}), 400

    now = _now_ms()

    with SessionLocal() as db:
        row: Optional[UserEntitlement] = db.get(UserEntitlement, uid)
        if row is None:
            row = UserEntitlement(
                firebase_uid=uid,
                pro_active=1,
                pro_expires_at_ms=expires_at_ms,
                created_at_ms=now,
                updated_at_ms=now,
            )
        else:
            row.pro_active = 1
            row.pro_expires_at_ms = expires_at_ms
            row.updated_at_ms = now

        db.add(row)
        db.commit()

    return jsonify({"ok": True, "uid": uid, "pro_active": True, "expires_at_ms": expires_at_ms})
