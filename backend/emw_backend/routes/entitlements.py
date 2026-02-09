from __future__ import annotations

import time
from typing import Optional

from flask import Blueprint, current_app, jsonify, request
from sqlalchemy import select

from emw_backend.auth import verify_request_identity
from emw_backend.config import Config
from emw_backend.db import SessionLocal
from emw_backend.models import UserEntitlement


entitlements_bp = Blueprint("entitlements", __name__)


def _now_ms() -> int:
    return int(time.time() * 1000)


def _require_identity(config: Config):
    ident = verify_request_identity(request, config)
    if not ident:
        return None, (jsonify({"error": "Unauthorized"}), 401)
    return ident, None


@entitlements_bp.get("/v1/entitlements")
def get_entitlements():
    """Return the user's current entitlements.

    Backend is authoritative; clients should treat this as the source of truth.
    """

    config: Config = current_app.config["EMWAVER_CONFIG"]
    ident, err = _require_identity(config)
    if err:
        return err

    now = _now_ms()

    with SessionLocal() as db:
        row: Optional[UserEntitlement] = db.get(UserEntitlement, ident.uid)

    pro = False
    expires_at_ms = None

    if row is not None:
        # If expires is missing, treat as non-expiring.
        if row.pro_active:
            if row.pro_expires_at_ms is None:
                pro = True
            else:
                pro = int(row.pro_expires_at_ms) > now
                expires_at_ms = int(row.pro_expires_at_ms)

    features = {
        "cloudHosts": pro,
        "cloudFiles": pro,
        "agent": pro,
    }

    return jsonify(
        {
            "pro": pro,
            "expires_at_ms": expires_at_ms,
            "features": features,
            "server_time_ms": now,
        }
    )
