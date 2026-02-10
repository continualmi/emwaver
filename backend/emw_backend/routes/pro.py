from __future__ import annotations

import time
from typing import Optional

from flask import Blueprint, Response, current_app, jsonify, request
from sqlalchemy import select

from emw_backend.auth import require_auth_user
from emw_backend.config import Config
from emw_backend.db import SessionLocal
from emw_backend.models import UserDevice, UserEntitlement


pro_bp = Blueprint("pro", __name__, url_prefix="/v1/pro")


def _now_ms() -> int:
    return int(time.time() * 1000)


def _cfg() -> Config:
    return current_app.config["EMWAVER_CONFIG"]


def _stripe_ready(cfg: Config) -> bool:
    return bool(cfg.stripe_secret_key and cfg.stripe_webhook_secret and cfg.pro_stripe_price_id)


def _require_eligible_user(cfg: Config):
    user = require_auth_user(cfg)
    with SessionLocal() as db:
        has_device = (
            db.execute(
                select(UserDevice.device_id_b64)
                .where(UserDevice.firebase_uid == user.firebase_uid)
                .limit(1)
            ).first()
            is not None
        )
    if not has_device:
        return None, (
            jsonify(
                {
                    "error": "not_eligible",
                    "reason": "no_device",
                    "detail": "Connect and attach a genuine EMWaver device to your account before subscribing.",
                }
            ),
            403,
        )
    return user, None


@pro_bp.post("/checkout_session")
def create_pro_checkout_session():
    """Create a Stripe Checkout Session for EMWaver Pro (subscription)."""

    cfg = _cfg()
    if not _stripe_ready(cfg):
        return (
            jsonify(
                {
                    "error": "pro_not_configured",
                    "detail": "Stripe Pro is not configured yet (missing STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET / PRO_STRIPE_PRICE_ID).",
                }
            ),
            503,
        )

    user, err = _require_eligible_user(cfg)
    if err:
        return err

    try:
        import stripe  # type: ignore
    except Exception:
        return jsonify({"error": "stripe_missing"}), 500

    stripe.api_key = cfg.stripe_secret_key

    success_url = cfg.pro_success_url or ""
    cancel_url = cfg.pro_cancel_url or ""
    if not success_url or not cancel_url:
        return (
            jsonify(
                {
                    "error": "pro_not_configured",
                    "detail": "Missing PRO_SUCCESS_URL or PRO_CANCEL_URL.",
                }
            ),
            503,
        )

    try:
        session = stripe.checkout.Session.create(
            mode="subscription",
            customer_email=user.email or None,
            client_reference_id=user.firebase_uid,
            line_items=[{"price": cfg.pro_stripe_price_id, "quantity": 1}],
            allow_promotion_codes=False,
            success_url=f"{success_url}?session_id={{CHECKOUT_SESSION_ID}}",
            cancel_url=cancel_url,
            metadata={
                "firebase_uid": user.firebase_uid,
            },
        )
        return jsonify({"url": session.url, "session_id": session.id})
    except Exception as e:
        return jsonify({"error": "stripe_error", "detail": str(e)}), 502


@pro_bp.post("/portal")
def create_customer_portal_session():
    """Create a Stripe Billing Portal session so the user can manage/cancel."""

    cfg = _cfg()
    if not (cfg.stripe_secret_key):
        return jsonify({"error": "pro_not_configured"}), 503

    user = require_auth_user(cfg)

    try:
        import stripe  # type: ignore
    except Exception:
        return jsonify({"error": "stripe_missing"}), 500

    stripe.api_key = cfg.stripe_secret_key

    # We don't store stripe_customer_id yet.
    # For now, search by email; if missing, portal won't work.
    # (We can improve this once we persist subscription/customer ids.)
    try:
        customers = stripe.Customer.list(email=user.email or "", limit=1)
        cid = customers.data[0].id if customers.data else None
        if not cid:
            return jsonify({"error": "no_customer", "detail": "No Stripe customer found for this email yet."}), 404

        return_url = cfg.pro_cancel_url or cfg.pro_success_url or ""
        ps = stripe.billing_portal.Session.create(customer=cid, return_url=return_url)
        return jsonify({"url": ps.url})
    except Exception as e:
        return jsonify({"error": "stripe_error", "detail": str(e)}), 502


@pro_bp.post("/stripe/webhook")
def stripe_pro_webhook():
    """Stripe webhook handler for subscription state updates.

    Minimal v1: mark Pro active when we see checkout.session.completed for subscription mode.
    We'll extend with customer.subscription.updated + invoice.paid later.
    """

    cfg = _cfg()
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
            mode = str(obj.get("mode") or "")
            if mode == "subscription":
                metadata = obj.get("metadata") or {}
                firebase_uid = str(metadata.get("firebase_uid") or "").strip()
                if firebase_uid:
                    now = _now_ms()
                    with SessionLocal() as db:
                        row: Optional[UserEntitlement] = db.get(UserEntitlement, firebase_uid)
                        if row is None:
                            row = UserEntitlement(firebase_uid=firebase_uid)
                        row.pro_active = 1
                        row.pro_expires_at_ms = None
                        row.updated_at_ms = now
                        db.add(row)
                        db.commit()

    except Exception:
        return jsonify({"error": "webhook_handler_failed"}), 500

    return Response("ok", status=200)
