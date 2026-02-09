from __future__ import annotations

import base64
import os
import time
from typing import Any, Dict

from flask import Blueprint, current_app, jsonify, request

from emw_backend.auth import verify_request_identity
from emw_backend.config import Config

# crypto (ed25519 signing)
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

provisioning_bp = Blueprint("provisioning", __name__, url_prefix="/provisioning")


def _cfg() -> Config:
    return current_app.config["EMWAVER_CONFIG"]


_MINT_BUCKET: Dict[str, Any] = {"window_s": 0, "count": 0}


def _require_ident() -> Any:
    cfg = _cfg()

    if not cfg.provisioning_enabled:
        return "disabled"

    ident = verify_request_identity(request, cfg)
    if not ident:
        return None

    # Prefer allowlisting by Firebase UID (stable). Support multiple in env.
    allowed_uids = [u for u in (cfg.provisioning_allowed_uids or []) if u]
    if allowed_uids:
        if ident.uid not in allowed_uids:
            return "forbidden"
        return ident

    # Legacy/backup allowlist (single email).
    if not ident.email or ident.email.lower() != (cfg.provisioning_allowed_email or "").lower():
        return "forbidden"

    return ident


def _rate_limit_ok(cfg: Config, key: str = "global") -> bool:
    """Very small in-memory rate limit.

    Good enough to stop accidental loops; not a security boundary.
    In multi-instance deployments this is per-instance.
    """

    rpm = int(cfg.provisioning_mint_rate_limit_per_minute or 0)
    if rpm <= 0:
        return True

    now = int(time.time())
    window = now // 60

    b = _MINT_BUCKET
    if b.get("window_s") != window:
        b["window_s"] = window
        b["count"] = 0

    if int(b.get("count") or 0) >= rpm:
        return False

    b["count"] = int(b.get("count") or 0) + 1
    return True


def _load_root_signing_key(cfg: Config) -> Ed25519PrivateKey:
    b64 = (cfg.provisioning_root_private_key_b64 or "").strip()
    if not b64:
        raise RuntimeError("Provisioning root private key not configured (EMWAVER_PROVISIONING_ROOT_PRIVATE_KEY_B64)")
    raw = base64.b64decode(b64)
    if len(raw) != 32:
        raise RuntimeError(f"Provisioning root private key must be 32 bytes, got {len(raw)}")
    return Ed25519PrivateKey.from_private_bytes(raw)


@provisioning_bp.post("/mint")
def mint() -> Any:
    ident = _require_ident()
    if ident is None:
        return jsonify({"error": "unauthorized"}), 401
    if ident == "disabled":
        return jsonify({"error": "disabled"}), 503
    if ident == "forbidden":
        return jsonify({"error": "forbidden"}), 403

    cfg = _cfg()

    if not _rate_limit_ok(cfg):
        return jsonify({"error": "rate_limited"}), 429

    sk = _load_root_signing_key(cfg)

    device_id = os.urandom(16)
    proof = sk.sign(device_id)  # 64 bytes

    out: Dict[str, Any] = {
        "device_id_b64": base64.b64encode(device_id).decode("ascii"),
        "proof_b64": base64.b64encode(proof).decode("ascii"),
        "algorithm": "ed25519",
        "device_id_len": 16,
        "proof_len": 64,
    }
    return jsonify(out)
