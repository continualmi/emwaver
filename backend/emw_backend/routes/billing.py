from __future__ import annotations

from flask import Blueprint, current_app, jsonify, request
from sqlalchemy import select

from emw_backend.auth import verify_request_identity
from emw_backend.config import Config
from emw_backend.db import SessionLocal
from emw_backend.models import UserDevice


billing_bp = Blueprint("billing", __name__)


def _require_identity(config: Config):
    ident = verify_request_identity(request, config)
    if not ident:
        return None, (jsonify({"error": "Unauthorized"}), 401)
    return ident, None


@billing_bp.get("/v1/billing/eligibility")
def pro_purchase_eligibility():
    """Eligibility to start/buy EMWaver Pro.

    Rule: user must be signed in AND have >=1 verified genuine device attached.

    Note: "device attached" is represented as a UserDevice row with firebase_uid set.
    """

    config: Config = current_app.config["EMWAVER_CONFIG"]
    ident, err = _require_identity(config)
    if err:
        return err

    with SessionLocal() as db:
        has_device = (
            db.execute(
                select(UserDevice.device_id_b64)
                .where(UserDevice.firebase_uid == ident.uid)
                .limit(1)
            ).first()
            is not None
        )

    if not has_device:
        return (
            jsonify(
                {
                    "canPurchasePro": False,
                    "reason": "no_device",
                    "requiresDeviceAttached": True,
                    "hasDeviceAttached": False,
                }
            ),
            200,
        )

    return (
        jsonify(
            {
                "canPurchasePro": True,
                "reason": None,
                "requiresDeviceAttached": True,
                "hasDeviceAttached": True,
            }
        ),
        200,
    )
