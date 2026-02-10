from __future__ import annotations

import time
from datetime import datetime, timezone
from typing import Optional

from flask import Blueprint, current_app, jsonify, request

from emw_backend.auth import verify_request_identity
from emw_backend.config import Config
from emw_backend.db import SessionLocal
from emw_backend.models import UserCreditBalance, UserEntitlement


credits_bp = Blueprint("credits", __name__)


PRO_MONTHLY_ALLOWANCE_TOKENS = 10_000_000
TOPUP_USD_PER_1M_TOKENS = 1


def _now_ms() -> int:
    return int(time.time() * 1000)


def _require_identity(cfg: Config):
    ident = verify_request_identity(request, cfg)
    if not ident:
        return None, (jsonify({"error": "Unauthorized"}), 401)
    return ident, None


def _iso(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000.0, tz=timezone.utc).isoformat().replace("+00:00", "Z")


@credits_bp.get("/v1/credits")
def get_credits():
    """Return the user's ELM credits (token balance).

    v1 model:
    - "credits" are measured in tokens.
    - Pro grants 10M tokens/month.
    - Tokens reset each period (no rollover).

    NOTE: Today we implement a rolling 30-day period window in the DB.
    Once Stripe Billing webhooks are fully wired, we should align the period to
    Stripe's subscription billing cycle.
    """

    cfg: Config = current_app.config["EMWAVER_CONFIG"]
    ident, err = _require_identity(cfg)
    if err:
        return err

    now = _now_ms()

    with SessionLocal() as db:
        ent: Optional[UserEntitlement] = db.get(UserEntitlement, ident.uid)
        is_pro = bool(ent and ent.pro_active)

        if not is_pro:
            return jsonify(
                {
                    "balance": 0,
                    "monthlyAllowance": 0,
                    "resetsAt": None,
                    "topupUsdPer1MTokens": TOPUP_USD_PER_1M_TOKENS,
                    "unit": "tokens",
                }
            )

        row: Optional[UserCreditBalance] = db.get(UserCreditBalance, ident.uid)

        # Initialize or roll the period.
        if row is None:
            period_start = now
            period_end = now + (30 * 24 * 60 * 60 * 1000)  # rolling 30d
            row = UserCreditBalance(
                firebase_uid=ident.uid,
                balance_tokens=PRO_MONTHLY_ALLOWANCE_TOKENS,
                period_start_ms=period_start,
                period_end_ms=period_end,
                updated_at_ms=now,
            )
            db.add(row)
            db.commit()
        else:
            if int(row.period_end_ms or 0) <= now:
                row.period_start_ms = now
                row.period_end_ms = now + (30 * 24 * 60 * 60 * 1000)
                row.balance_tokens = PRO_MONTHLY_ALLOWANCE_TOKENS
                row.updated_at_ms = now
                db.add(row)
                db.commit()

        return jsonify(
            {
                "balance": int(row.balance_tokens or 0),
                "monthlyAllowance": PRO_MONTHLY_ALLOWANCE_TOKENS,
                "resetsAt": _iso(int(row.period_end_ms or 0)),
                "topupUsdPer1MTokens": TOPUP_USD_PER_1M_TOKENS,
                "unit": "tokens",
            }
        )
