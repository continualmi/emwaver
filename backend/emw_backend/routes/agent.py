from __future__ import annotations

import json
import time
from typing import Any, Dict, Iterable, List, Optional

from flask import Blueprint, Response, current_app, jsonify, request
from openai import OpenAI
from sqlalchemy import desc, select

from emw_backend.auth import verify_request_identity
from emw_backend.config import Config
from emw_backend.db import SessionLocal
from emw_backend.models import AgentConversation, AgentMessage


agent_bp = Blueprint("agent", __name__)


def _now_ms() -> int:
    return int(time.time() * 1000)


def _require_identity(config: Config):
    ident = verify_request_identity(request, config)
    if not ident:
        return None, (jsonify({"error": "Unauthorized"}), 401)
    return ident, None


def _require_openai(config: Config) -> OpenAI:
    if not config.openai_base_url:
        raise RuntimeError("Missing OPENAI_BASE_URL")
    if not config.openai_model:
        raise RuntimeError("Missing OPENAI_MODEL")
    # OPENAI_API_KEY can be empty if you are pointing at a local OpenAI-compatible server.
    return OpenAI(api_key=(config.openai_api_key or None), base_url=config.openai_base_url)


def _sse(event: str, data: Any) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


# --- Conversations ---


@agent_bp.get("/v1/agent/conversations")
def list_conversations():
    config: Config = current_app.config["EMWAVER_CONFIG"]
    ident, err = _require_identity(config)
    if err:
        return err

    with SessionLocal() as db:
        rows = db.execute(
            select(AgentConversation)
            .where(AgentConversation.firebase_uid == ident.uid)
            .order_by(desc(AgentConversation.updated_at_ms))
            .limit(200)
        ).scalars().all()

        return jsonify(
            {
                "conversations": [
                    {
                        "id": r.id,
                        "title": r.title,
                        "created_at_ms": r.created_at_ms,
                        "updated_at_ms": r.updated_at_ms,
                    }
                    for r in rows
                ]
            }
        )


@agent_bp.post("/v1/agent/conversations")
def create_conversation():
    config: Config = current_app.config["EMWAVER_CONFIG"]
    ident, err = _require_identity(config)
    if err:
        return err

    payload = request.get_json(force=True, silent=True) or {}
    if not isinstance(payload, dict):
        return jsonify({"error": "Invalid JSON payload"}), 400

    title = payload.get("title")
    if title is not None and not isinstance(title, str):
        return jsonify({"error": "Invalid 'title'"}), 400
    title = (title or "").strip() or None

    now = _now_ms()
    c = AgentConversation(firebase_uid=ident.uid, title=title, created_at_ms=now, updated_at_ms=now)

    with SessionLocal() as db:
        db.add(c)
        db.commit()
        db.refresh(c)

    return jsonify(
        {
            "conversation": {
                "id": c.id,
                "title": c.title,
                "created_at_ms": c.created_at_ms,
                "updated_at_ms": c.updated_at_ms,
            }
        }
    )


@agent_bp.get("/v1/agent/conversations/<conversation_id>/messages")
def list_messages(conversation_id: str):
    config: Config = current_app.config["EMWAVER_CONFIG"]
    ident, err = _require_identity(config)
    if err:
        return err

    with SessionLocal() as db:
        convo = db.get(AgentConversation, conversation_id)
        if not convo or convo.firebase_uid != ident.uid:
            return jsonify({"error": "Not found"}), 404

        rows = (
            db.execute(
                select(AgentMessage)
                .where(AgentMessage.conversation_id == conversation_id)
                .where(AgentMessage.firebase_uid == ident.uid)
                .order_by(AgentMessage.created_at_ms)
                .limit(2000)
            )
            .scalars()
            .all()
        )

        return jsonify(
            {
                "messages": [
                    {
                        "id": r.id,
                        "role": r.role,
                        "content": r.content,
                        "created_at_ms": r.created_at_ms,
                    }
                    for r in rows
                ]
            }
        )


# --- Chat completions (persisted) ---


def _build_openai_messages_from_db(db, *, uid: str, conversation_id: str) -> List[Dict[str, str]]:
    rows = (
        db.execute(
            select(AgentMessage)
            .where(AgentMessage.conversation_id == conversation_id)
            .where(AgentMessage.firebase_uid == uid)
            .order_by(AgentMessage.created_at_ms)
            .limit(2000)
        )
        .scalars()
        .all()
    )
    return [{"role": r.role, "content": r.content} for r in rows]


@agent_bp.post("/v1/agent/chat")
def agent_chat():
    """Non-streaming chat completion that persists user+assistant turns to Postgres.

    Upstream is OpenAI-compatible via OPENAI_BASE_URL / OPENAI_API_KEY.
    Model is forced from OPENAI_MODEL.
    """

    started = time.time()
    config: Config = current_app.config["EMWAVER_CONFIG"]
    ident, err = _require_identity(config)
    if err:
        return err

    payload = request.get_json(force=True, silent=False)
    if not isinstance(payload, dict):
        return jsonify({"error": "Invalid JSON payload"}), 400

    conversation_id = payload.get("conversation_id")
    user_content = payload.get("message")
    max_tokens = int(payload.get("max_tokens", 512))
    temperature = float(payload.get("temperature", 0.2))

    if not isinstance(conversation_id, str) or not conversation_id:
        return jsonify({"error": "Missing 'conversation_id'"}), 400
    if not isinstance(user_content, str) or not user_content.strip():
        return jsonify({"error": "Missing 'message'"}), 400

    now = _now_ms()

    try:
        client = _require_openai(config)

        with SessionLocal() as db:
            convo = db.get(AgentConversation, conversation_id)
            if not convo or convo.firebase_uid != ident.uid:
                return jsonify({"error": "Not found"}), 404

            # persist user msg
            umsg = AgentMessage(
                conversation_id=conversation_id,
                firebase_uid=ident.uid,
                role="user",
                content=user_content,
                created_at_ms=now,
            )
            db.add(umsg)
            db.commit()

            # build full history -> completion
            messages = _build_openai_messages_from_db(db, uid=ident.uid, conversation_id=conversation_id)

        resp = client.chat.completions.create(
            model=config.openai_model,
            messages=messages,
            max_tokens=max_tokens,
            temperature=temperature,
        )

        assistant_content = (resp.choices[0].message.content or "").strip()
        if not assistant_content:
            raise RuntimeError("Upstream response missing message content")

        with SessionLocal() as db:
            convo = db.get(AgentConversation, conversation_id)
            if not convo or convo.firebase_uid != ident.uid:
                return jsonify({"error": "Not found"}), 404

            amsg = AgentMessage(
                conversation_id=conversation_id,
                firebase_uid=ident.uid,
                role="assistant",
                content=assistant_content,
                created_at_ms=_now_ms(),
            )
            db.add(amsg)
            convo.updated_at_ms = _now_ms()
            db.add(convo)
            db.commit()
            db.refresh(amsg)

            return jsonify(
                {
                    "message": {
                        "id": amsg.id,
                        "role": amsg.role,
                        "content": amsg.content,
                        "created_at_ms": amsg.created_at_ms,
                    },
                    "model": config.openai_model,
                }
            )

    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        _ = time.time() - started


@agent_bp.post("/v1/agent/chat/stream")
def agent_chat_stream():
    """Streaming SSE completion that persists user+assistant turns to Postgres.

    SSE events emitted by this endpoint:
    - event: delta  data: {"text": "..."}
    - event: done   data: {"message": {...}, "model": "..."}
    - event: error  data: {"error": "..."}
    """

    config: Config = current_app.config["EMWAVER_CONFIG"]
    ident, err = _require_identity(config)
    if err:
        return err

    payload = request.get_json(force=True, silent=False)
    if not isinstance(payload, dict):
        return jsonify({"error": "Invalid JSON payload"}), 400

    conversation_id = payload.get("conversation_id")
    user_content = payload.get("message")
    max_tokens = int(payload.get("max_tokens", 512))
    temperature = float(payload.get("temperature", 0.2))

    if not isinstance(conversation_id, str) or not conversation_id:
        return jsonify({"error": "Missing 'conversation_id'"}), 400
    if not isinstance(user_content, str) or not user_content.strip():
        return jsonify({"error": "Missing 'message'"}), 400

    def gen() -> Iterable[str]:
        assistant_text_parts: List[str] = []

        try:
            client = _require_openai(config)

            now = _now_ms()
            with SessionLocal() as db:
                convo = db.get(AgentConversation, conversation_id)
                if not convo or convo.firebase_uid != ident.uid:
                    yield _sse("error", {"error": "Not found"})
                    return

                umsg = AgentMessage(
                    conversation_id=conversation_id,
                    firebase_uid=ident.uid,
                    role="user",
                    content=user_content,
                    created_at_ms=now,
                )
                db.add(umsg)
                db.commit()

                messages = _build_openai_messages_from_db(db, uid=ident.uid, conversation_id=conversation_id)

            stream = client.chat.completions.create(
                model=config.openai_model,
                messages=messages,
                max_tokens=max_tokens,
                temperature=temperature,
                stream=True,
            )

            for chunk in stream:
                try:
                    delta = chunk.choices[0].delta.content
                except Exception:
                    delta = None
                if delta:
                    assistant_text_parts.append(str(delta))
                    yield _sse("delta", {"text": str(delta)})

            full = "".join(assistant_text_parts).strip()
            if not full:
                yield _sse("error", {"error": "Upstream produced no content"})
                return

            with SessionLocal() as db:
                convo = db.get(AgentConversation, conversation_id)
                if not convo or convo.firebase_uid != ident.uid:
                    yield _sse("error", {"error": "Not found"})
                    return

                amsg = AgentMessage(
                    conversation_id=conversation_id,
                    firebase_uid=ident.uid,
                    role="assistant",
                    content=full,
                    created_at_ms=_now_ms(),
                )
                db.add(amsg)
                convo.updated_at_ms = _now_ms()
                db.add(convo)
                db.commit()
                db.refresh(amsg)

                yield _sse(
                    "done",
                    {
                        "message": {
                            "id": amsg.id,
                            "role": amsg.role,
                            "content": amsg.content,
                            "created_at_ms": amsg.created_at_ms,
                        },
                        "model": config.openai_model,
                    },
                )

        except Exception as e:
            yield _sse("error", {"error": str(e)})

    return Response(gen(), mimetype="text/event-stream")
