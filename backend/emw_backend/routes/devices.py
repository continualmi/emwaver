from __future__ import annotations

import base64
import time
from typing import Any, Optional

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from flask import Blueprint, current_app, jsonify, request

from emw_backend.auth import optional_auth_user, require_auth_user
from emw_backend.config import Config
from emw_backend.db import db_session
from emw_backend.models import UserDevice


devices_bp = Blueprint("devices", __name__, url_prefix="/v1/devices")


def _now_ms() -> int:
    return int(time.time() * 1000)


def _cfg() -> Config:
    return current_app.config["EMWAVER_CONFIG"]


def _load_root_pub(cfg: Config) -> Ed25519PublicKey:
    b64 = (cfg.root_public_key_b64 or "").strip()
    if not b64:
        raise RuntimeError("Missing EMWAVER_ROOT_PUBLIC_KEY_B64")
    raw = base64.b64decode(b64)
    if len(raw) != 32:
        raise RuntimeError(f"Root public key must be 32 bytes, got {len(raw)}")
    return Ed25519PublicKey.from_public_bytes(raw)


def _parse_b64(name: str, v: Any, expected_len: Optional[int] = None) -> bytes:
    if not isinstance(v, str) or not v.strip():
        raise ValueError(f"missing_{name}")
    raw = base64.b64decode(v.strip())
    if expected_len is not None and len(raw) != expected_len:
        raise ValueError(f"invalid_{name}_len")
    return raw


@devices_bp.post("/attach")
def attach_device():
    """Attach a backend-minted device identity to the authenticated user.

    Payload: { device_id_b64, proof_b64 }

    - Verifies Proof = Sign_root(DeviceID) (ed25519)
    - Requires auth; if you want a preflight check w/out auth, use /seen.
    """

    cfg = _cfg()
    user = require_auth_user(cfg)

    if not cfg.root_public_key_b64:
        return jsonify({"error": "root_key_not_configured"}), 503

    payload = request.get_json(silent=True) or {}
    try:
        device_id = _parse_b64("device_id_b64", payload.get("device_id_b64"), expected_len=16)
        proof = _parse_b64("proof_b64", payload.get("proof_b64"), expected_len=64)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception:
        return jsonify({"error": "invalid_base64"}), 400

    try:
        pub = _load_root_pub(cfg)
        pub.verify(proof, device_id)
    except Exception:
        return jsonify({"error": "invalid_proof"}), 400

    device_id_b64 = base64.b64encode(device_id).decode("ascii")
    proof_b64 = base64.b64encode(proof).decode("ascii")

    with next(db_session()) as db:
        row = db.get(UserDevice, device_id_b64)
        if row and row.firebase_uid and row.firebase_uid != user.firebase_uid:
            # Do not allow stealing a device that is already attached.
            return jsonify({"error": "device_already_attached"}), 409

        if not row:
            row = UserDevice(
                device_id_b64=device_id_b64,
                proof_b64=proof_b64,
                firebase_uid=user.firebase_uid,
                label="",
                created_at_ms=_now_ms(),
                updated_at_ms=_now_ms(),
                last_seen_at_ms=_now_ms(),
            )
        else:
            row.proof_b64 = proof_b64
            row.firebase_uid = user.firebase_uid
            row.updated_at_ms = _now_ms()
            row.last_seen_at_ms = _now_ms()

        db.add(row)
        db.commit()

    return jsonify({"device": row.to_public_dict()})


@devices_bp.post("/seen")
def seen_device():
    """Verify identity and optionally attach if authenticated.

    Payload: { device_id_b64, proof_b64 }

    Response:
    - { ok:true, attached:true/false, needs_login:true/false, claimed:true/false }

    Intended flow:
    - If user is not logged in: frontend can call this to validate proof and decide to prompt login.
    - If logged in: call this and it will attach.
    """

    cfg = _cfg()
    if not cfg.root_public_key_b64:
        return jsonify({"error": "root_key_not_configured"}), 503

    payload = request.get_json(silent=True) or {}
    try:
        device_id = _parse_b64("device_id_b64", payload.get("device_id_b64"), expected_len=16)
        proof = _parse_b64("proof_b64", payload.get("proof_b64"), expected_len=64)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception:
        return jsonify({"error": "invalid_base64"}), 400

    try:
        pub = _load_root_pub(cfg)
        pub.verify(proof, device_id)
    except Exception:
        return jsonify({"error": "invalid_proof"}), 400

    device_id_b64 = base64.b64encode(device_id).decode("ascii")
    proof_b64 = base64.b64encode(proof).decode("ascii")

    # If logged in, attach.
    user = optional_auth_user(cfg)
    if user:
        with next(db_session()) as db:
            row = db.get(UserDevice, device_id_b64)
            if row and row.firebase_uid and row.firebase_uid != user.firebase_uid:
                return jsonify({"ok": True, "attached": False, "claimed": True, "needs_login": False}), 200

            if not row:
                row = UserDevice(
                    device_id_b64=device_id_b64,
                    proof_b64=proof_b64,
                    firebase_uid=user.firebase_uid,
                    label="",
                    created_at_ms=_now_ms(),
                    updated_at_ms=_now_ms(),
                    last_seen_at_ms=_now_ms(),
                )
            else:
                row.proof_b64 = proof_b64
                row.firebase_uid = user.firebase_uid
                row.updated_at_ms = _now_ms()
                row.last_seen_at_ms = _now_ms()
            db.add(row)
            db.commit()
        return jsonify({"ok": True, "attached": True, "claimed": True, "needs_login": False}), 200

    # Not logged in: just check whether we already know the device.
    with next(db_session()) as db:
        row = db.get(UserDevice, device_id_b64)
        claimed = bool(row and row.firebase_uid)
    return jsonify({"ok": True, "attached": False, "claimed": claimed, "needs_login": True}), 200


@devices_bp.get("/my")
def my_devices():
    cfg = _cfg()
    user = require_auth_user(cfg)

    with next(db_session()) as db:
        rows = (
            db.query(UserDevice)
            .filter(UserDevice.firebase_uid == user.firebase_uid)
            .order_by(UserDevice.created_at_ms.desc())
            .limit(100)
            .all()
        )

    return jsonify({"devices": [r.to_public_dict() for r in rows]})


@devices_bp.post("/label")
def set_device_label():
    cfg = _cfg()
    user = require_auth_user(cfg)

    payload = request.get_json(silent=True) or {}
    device_id_b64 = str(payload.get("device_id_b64") or "").strip()
    label = str(payload.get("label") or "").strip()

    if not device_id_b64:
        return jsonify({"error": "missing_device_id_b64"}), 400

    with next(db_session()) as db:
        row = db.get(UserDevice, device_id_b64)
        if not row or row.firebase_uid != user.firebase_uid:
            return jsonify({"error": "not_found"}), 404
        row.label = label[:128]
        row.updated_at_ms = _now_ms()
        db.add(row)
        db.commit()
        return jsonify({"device": row.to_public_dict()})
