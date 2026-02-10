from __future__ import annotations

import base64
import hashlib
import os
import secrets
import time
from dataclasses import dataclass
from typing import Optional

from flask import Blueprint, current_app, jsonify, request
from sqlalchemy import select

from emw_backend.auth import verify_request_identity
from emw_backend.config import Config
from emw_backend.db import SessionLocal
from emw_backend.models import AuthHandoffCode


auth_handoff_bp = Blueprint("auth_handoff", __name__, url_prefix="/v1/auth/handoff")


def _now_ms() -> int:
    return int(time.time() * 1000)


def _cfg() -> Config:
    return current_app.config["EMWAVER_CONFIG"]


def _require_identity(cfg: Config):
    ident = verify_request_identity(request, cfg)
    if not ident:
        return None, (jsonify({"error": "Unauthorized"}), 401)
    return ident, None


def _random_code() -> str:
    # Human-friendly code: EMW-XXXXXX
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    body = "".join(secrets.choice(alphabet) for _ in range(6))
    return f"EMW-{body}"


def _hash_code(code: str) -> str:
    return hashlib.sha256(code.strip().upper().encode("utf-8")).hexdigest()


def _firebase_admin_available() -> bool:
    return bool(os.environ.get("FIREBASE_ADMIN_JSON_B64", "").strip())


def _firebase_admin_credentials_json() -> dict:
    raw = os.environ.get("FIREBASE_ADMIN_JSON_B64", "").strip()
    if not raw:
        raise RuntimeError("Missing FIREBASE_ADMIN_JSON_B64")
    data = base64.b64decode(raw)
    import json

    return json.loads(data.decode("utf-8"))


def _mint_custom_token(uid: str) -> str:
    # Lazy import to keep cold start light.
    import firebase_admin  # type: ignore
    from firebase_admin import auth as fb_auth  # type: ignore
    from firebase_admin import credentials  # type: ignore

    # Initialize default app once.
    if not firebase_admin._apps:  # type: ignore
        cred = credentials.Certificate(_firebase_admin_credentials_json())
        firebase_admin.initialize_app(cred)

    tok = fb_auth.create_custom_token(uid)
    if isinstance(tok, bytes):
        return tok.decode("utf-8")
    return str(tok)


@auth_handoff_bp.post("/start")
def start_handoff():
    """Start a web->native sign-in handoff.

    Requires an authenticated web user. Returns a short-lived code.
    """

    cfg = _cfg()
    ident, err = _require_identity(cfg)
    if err:
        return err

    code = _random_code()
    code_hash = _hash_code(code)
    now = _now_ms()
    expires_at_ms = now + (10 * 60 * 1000)

    with SessionLocal() as db:
        # Best effort: remove old codes for this user.
        try:
            rows = db.execute(
                select(AuthHandoffCode).where(AuthHandoffCode.firebase_uid == ident.uid)
            ).scalars().all()
            for r in rows:
                db.delete(r)
        except Exception:
            pass

        row = AuthHandoffCode(
            code_hash=code_hash,
            firebase_uid=ident.uid,
            created_at_ms=now,
            expires_at_ms=expires_at_ms,
            consumed_at_ms=None,
        )
        db.add(row)
        db.commit()

    return jsonify({"code": code, "expires_at_ms": expires_at_ms})


@auth_handoff_bp.post("/consume")
def consume_handoff():
    """Consume a handoff code and return a Firebase custom token.

    Native clients use this to sign in via signInWithCustomToken.
    """

    cfg = _cfg()

    if not _firebase_admin_available():
        return (
            jsonify(
                {
                    "error": "not_configured",
                    "detail": "Backend is missing FIREBASE_ADMIN_JSON_B64 (Firebase Admin service account JSON, base64).",
                }
            ),
            503,
        )

    payload = request.get_json(silent=True) or {}
    code = str(payload.get("code") or "").strip().upper()
    if not code:
        return jsonify({"error": "missing_code"}), 400

    code_hash = _hash_code(code)
    now = _now_ms()

    with SessionLocal() as db:
        row: Optional[AuthHandoffCode] = db.get(AuthHandoffCode, code_hash)
        if not row:
            return jsonify({"error": "invalid_code"}), 404
        if row.consumed_at_ms:
            return jsonify({"error": "already_consumed"}), 409
        if int(row.expires_at_ms or 0) < now:
            return jsonify({"error": "expired"}), 410

        # Mark consumed first to prevent races.
        row.consumed_at_ms = now
        db.add(row)
        db.commit()

        uid = row.firebase_uid

    try:
        custom_token = _mint_custom_token(uid)
    except Exception as e:
        return jsonify({"error": "token_mint_failed", "detail": str(e)}), 502

    return jsonify({"firebase_custom_token": custom_token, "uid": uid})
