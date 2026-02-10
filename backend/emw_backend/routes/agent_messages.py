from __future__ import annotations

import time
from typing import Any, Optional

from flask import Blueprint, current_app, jsonify, request

from emw_backend.auth import verify_request_identity
from emw_backend.config import Config
from emw_backend.db import SessionLocal
from emw_backend.models import AgentConversation, AgentMessage


agent_messages_bp = Blueprint("agent_messages", __name__)


def _now_ms() -> int:
    return int(time.time() * 1000)


def _require_identity(config: Config):
    ident = verify_request_identity(request, config)
    if not ident:
        return None, (jsonify({"error": "Unauthorized"}), 401)
    return ident, None


@agent_messages_bp.post("/v1/agent/conversations/<conversation_id>/messages")
def append_message(conversation_id: str):
    """Append a message to a conversation (persist-only; no inference).

    This is used by clients that run inference locally (e.g. ChatGPT/Codex via browser)
    but still want cloud conversation storage.

    Payload: {"role": "user"|"assistant"|"system", "content": "...", "created_at_ms"?: int}
    """

    config: Config = current_app.config["EMWAVER_CONFIG"]
    ident, err = _require_identity(config)
    if err:
        return err

    payload = request.get_json(force=True, silent=True) or {}
    if not isinstance(payload, dict):
        return jsonify({"error": "Invalid JSON payload"}), 400

    role = payload.get("role")
    content = payload.get("content")
    created_at_ms = payload.get("created_at_ms")

    if not isinstance(role, str) or role not in ("user", "assistant", "system"):
        return jsonify({"error": "Invalid 'role'"}), 400
    if not isinstance(content, str) or not content.strip():
        return jsonify({"error": "Invalid 'content'"}), 400

    if created_at_ms is not None:
        try:
            created_at_ms = int(created_at_ms)
        except Exception:
            return jsonify({"error": "Invalid 'created_at_ms'"}), 400
    else:
        created_at_ms = _now_ms()

    with SessionLocal() as db:
        convo: Optional[AgentConversation] = db.get(AgentConversation, conversation_id)
        if not convo or convo.firebase_uid != ident.uid:
            return jsonify({"error": "Not found"}), 404

        msg = AgentMessage(
            conversation_id=conversation_id,
            firebase_uid=ident.uid,
            role=role,
            content=content,
            created_at_ms=created_at_ms,
        )
        db.add(msg)

        convo.updated_at_ms = _now_ms()
        db.add(convo)

        db.commit()
        db.refresh(msg)

    return jsonify(
        {
            "message": {
                "id": msg.id,
                "role": msg.role,
                "content": msg.content,
                "created_at_ms": msg.created_at_ms,
            }
        }
    )
