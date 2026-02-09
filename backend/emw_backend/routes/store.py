from __future__ import annotations

import json
import time
import uuid
from dataclasses import asdict
from typing import Any, Optional

from flask import Blueprint, Response, current_app, jsonify, request

from emw_backend.auth import optional_auth_user, require_auth_user
from emw_backend.config import Config
from emw_backend.db import db_session
from emw_backend.models import StoreOrder

store_bp = Blueprint("store", __name__, url_prefix="/v1/store")


def _now_ms() -> int:
    return int(time.time() * 1000)


def _get_cfg() -> Config:
    return current_app.config["EMWAVER_CONFIG"]


def _stripe_enabled(cfg: Config) -> bool:
    return bool(cfg.stripe_secret_key and cfg.store_stripe_price_id)


@store_bp.post("/checkout_session")
def create_checkout_session():
    """Create a Stripe Checkout Session.

    Flow v1:
    - email is required
    - auth is optional (guest allowed)
    - qty selectable (1-5)

    Returns: { url, session_id }
    """

    cfg = _get_cfg()
    if not _stripe_enabled(cfg):
        return (
            jsonify(
                {
                    "error": "store_not_configured",
                    "detail": "Stripe is not configured yet (missing STRIPE_SECRET_KEY or STORE_STRIPE_PRICE_ID).",
                }
            ),
            503,
        )

    try:
        import stripe  # type: ignore
    except Exception:
        return (
            jsonify(
                {
                    "error": "stripe_missing",
                    "detail": "Backend is missing the stripe Python package.",
                }
            ),
            500,
        )

    stripe.api_key = cfg.stripe_secret_key

    payload = request.get_json(silent=True) or {}
    email = str(payload.get("email") or "").strip()
    if not email or "@" not in email:
        return jsonify({"error": "invalid_email"}), 400

    qty_raw = payload.get("quantity", 1)
    try:
        qty = int(qty_raw)
    except Exception:
        qty = 1
    qty = max(1, min(5, qty))

    # Optional auth: if present, we can link immediately.
    user = optional_auth_user(cfg)
    firebase_uid: Optional[str] = user.firebase_uid if user else None

    order_id = str(uuid.uuid4())

    success_url = cfg.store_success_url
    cancel_url = cfg.store_cancel_url

    try:
        session = stripe.checkout.Session.create(
            mode="payment",
            customer_email=email,
            client_reference_id=firebase_uid or None,
            line_items=[{"price": cfg.store_stripe_price_id, "quantity": qty}],
            allow_promotion_codes=False,
            billing_address_collection="required",
            shipping_address_collection={"allowed_countries": cfg.store_shipping_countries},
            success_url=f"{success_url}?session_id={{CHECKOUT_SESSION_ID}}",
            cancel_url=cancel_url,
            metadata={
                "order_id": order_id,
                "firebase_uid": firebase_uid or "",
            },
        )

        # Persist a draft order now so we can reconcile even if webhooks arrive late.
        with next(db_session()) as db:
            o = StoreOrder(
                id=order_id,
                status="created",
                email=email,
                firebase_uid=firebase_uid,
                quantity=qty,
                stripe_checkout_session_id=str(session.id),
                stripe_payment_intent_id=str(session.payment_intent or ""),
                currency=str(getattr(session, "currency", "") or ""),
                amount_total=int(getattr(session, "amount_total", 0) or 0),
                shipping_json="{}",
                created_at_ms=_now_ms(),
                updated_at_ms=_now_ms(),
            )
            db.add(o)
            db.commit()

        return jsonify({"url": session.url, "session_id": session.id, "order_id": order_id})

    except Exception as e:
        return jsonify({"error": "stripe_error", "detail": str(e)}), 502


@store_bp.post("/stripe/webhook")
def stripe_webhook():
    cfg = _get_cfg()
    if not cfg.stripe_webhook_secret:
        return jsonify({"error": "webhook_not_configured"}), 503

    try:
        import stripe  # type: ignore
    except Exception:
        return jsonify({"error": "stripe_missing"}), 500

    stripe.api_key = cfg.stripe_secret_key

    sig = request.headers.get("Stripe-Signature", "")
    raw = request.get_data(cache=False, as_text=False)

    try:
        event = stripe.Webhook.construct_event(raw, sig, cfg.stripe_webhook_secret)
    except Exception as e:
        return jsonify({"error": "invalid_signature", "detail": str(e)}), 400

    et = str(event.get("type") or "")
    obj = (event.get("data") or {}).get("object") or {}

    try:
        if et == "checkout.session.completed":
            sid = str(obj.get("id") or "")
            paid = (obj.get("payment_status") or "").lower() == "paid"
            metadata = obj.get("metadata") or {}
            order_id = str(metadata.get("order_id") or "")
            firebase_uid = str(metadata.get("firebase_uid") or "").strip() or None
            payment_intent = str(obj.get("payment_intent") or "")

            shipping = obj.get("shipping_details") or {}
            shipping_json = json.dumps(shipping) if shipping else "{}"

            with next(db_session()) as db:
                o = None
                if order_id:
                    o = db.get(StoreOrder, order_id)
                if not o and sid:
                    o = (
                        db.query(StoreOrder)
                        .filter(StoreOrder.stripe_checkout_session_id == sid)
                        .order_by(StoreOrder.created_at_ms.desc())
                        .first()
                    )
                if o:
                    o.status = "paid" if paid else "completed"
                    if firebase_uid and not o.firebase_uid:
                        o.firebase_uid = firebase_uid
                    if payment_intent:
                        o.stripe_payment_intent_id = payment_intent
                    o.shipping_json = shipping_json
                    o.updated_at_ms = _now_ms()
                    db.add(o)
                    db.commit()

        # Future: handle refunds, disputes, etc.

    except Exception:
        # Stripe expects a 2xx to stop retries only when processing succeeded.
        return jsonify({"error": "webhook_handler_failed"}), 500

    return Response("ok", status=200)


@store_bp.get("/orders/my")
def my_orders():
    cfg = _get_cfg()
    user = require_auth_user(cfg)

    with next(db_session()) as db:
        rows = (
            db.query(StoreOrder)
            .filter(StoreOrder.firebase_uid == user.firebase_uid)
            .order_by(StoreOrder.created_at_ms.desc())
            .limit(50)
            .all()
        )

    return jsonify({"orders": [r.to_public_dict() for r in rows]})


@store_bp.post("/orders/claim")
def claim_order():
    cfg = _get_cfg()
    user = require_auth_user(cfg)

    payload = request.get_json(silent=True) or {}
    session_id = str(payload.get("session_id") or "").strip()
    if not session_id:
        return jsonify({"error": "missing_session_id"}), 400

    with next(db_session()) as db:
        o = (
            db.query(StoreOrder)
            .filter(StoreOrder.stripe_checkout_session_id == session_id)
            .order_by(StoreOrder.created_at_ms.desc())
            .first()
        )
        if not o:
            return jsonify({"error": "not_found"}), 404

        # Basic safety: only allow claim if it isn't already owned.
        if o.firebase_uid and o.firebase_uid != user.firebase_uid:
            return jsonify({"error": "already_claimed"}), 409

        o.firebase_uid = user.firebase_uid
        o.updated_at_ms = _now_ms()
        db.add(o)
        db.commit()

        return jsonify({"order": o.to_public_dict()})
