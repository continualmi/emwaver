from __future__ import annotations

import base64
import os
from dataclasses import asdict
from typing import Any, Dict

from flask import Blueprint, current_app, jsonify, request

from emw_backend.auth import verify_request_identity
from emw_backend.config import Config

# crypto (ed25519 signing)
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

provisioning_bp = Blueprint("provisioning", __name__, url_prefix="/provisioning")


def _cfg() -> Config:
    return current_app.config["EMWAVER_CONFIG"]


def _require_ident() -> Any:
    cfg = _cfg()
    ident = verify_request_identity(request, cfg)
    if not ident:
        return None
    # Hard allowlist (single email)
    if not ident.email or ident.email.lower() != (cfg.provisioning_allowed_email or "").lower():
        return "forbidden"
    return ident


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
    if ident == "forbidden":
        return jsonify({"error": "forbidden"}), 403

    cfg = _cfg()
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
