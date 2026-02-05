from __future__ import annotations

import json
import time
from typing import Any, Dict, Iterable, List, Optional, Tuple

import requests
from flask import Blueprint, Response, current_app, jsonify, request
from sqlalchemy import desc, select

from emw_backend.auth import verify_request_identity
from emw_backend.config import Config
from emw_backend.db import SessionLocal
from emw_backend.models import AgentConversation, AgentMessage


OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

agent_bp = Blueprint("agent", __name__)


def _now_ms() -> int:
    return int(time.time() * 1000)


def _require_identity(config: Config):
    ident = verify_request_identity(request, config)
    if not ident:
        return None, (jsonify({"error": "Unauthorized"}), 401)
    return ident, None


def _openrouter_headers(config: Config) -> Dict[str, str]:
    if not config.openrouter_api_key:
        raise RuntimeError("Missing OPENROUTER_API_KEY")
    return {
        "Authorization": f"Bearer {config.openrouter_api_key}",
        "X-Title": "EMWaver",
        "User-Agent": "EMWaver/backend",
    }


def _openrouter_chat(
    *,
    config: Config,
    model: Optional[str],
    messages: List[Dict[str, Any]],
    max_tokens: int = 512,
    temperature: float = 0.2,
) -> Tuple[str, str]:
    """Returns (content, resolved_model)."""

    resolved_model = (model or config.openrouter_model or "").strip()
    if not resolved_model:
        raise ValueError("Invalid 'model'")
    if not isinstance(messages, list) or not messages:
        raise ValueError("Invalid 'messages'")

    req_body = {
        "model": resolved_model,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": temperature,
        "stream": False,
    }

    resp = requests.post(
        OPENROUTER_URL,
        json=req_body,
        headers=_openrouter_headers(config),
        timeout=90,
    )

    if resp.status_code < 200 or resp.status_code >= 300:
        raise RuntimeError(f"OpenRouter error ({resp.status_code}): {resp.text}")

    data = resp.json()
    content = None
    try:
        content = data.get("choices", [])[0].get("message", {}).get("content", "")
        content = (content or "").strip()
    except Exception:
        content = None

    if not content:
        raise RuntimeError("OpenRouter response missing message content")

    return content, (data.get("model") or resolved_model)


def _openrouter_stream(
    *,
    config: Config,
    model: Optional[str],
    messages: List[Dict[str, Any]],
    max_tokens: int = 512,
    temperature: float = 0.2,
) -> Iterable[str]:
    """Yields OpenAI-style SSE lines (data: ...\n\n)."""

    resolved_model = (model or config.openrouter_model or "").strip()
    if not resolved_model:
        raise ValueError("Invalid 'model'")
    if not isinstance(messages, list) or not messages:
        raise ValueError("Invalid 'messages'")

    req_body = {
        "model": resolved_model,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": temperature,
        "stream": True,
    }

    with requests.post(
        OPENROUTER_URL,
        json=req_body,
        headers=_openrouter_headers(config),
        timeout=90,
        stream=True,
    ) as resp:
        if resp.status_code < 200 or resp.status_code >= 300:
            # try to read some body for error context
            try:
                body = resp.text
            except Exception:
                body = ""
            raise RuntimeError(f"OpenRouter error ({resp.status_code}): {body}")

        # OpenRouter streams Server-Sent Events compatible with OpenAI.
        for raw in resp.iter_lines(decode_unicode=True):
            if raw is None:
                continue
            line = raw.strip("\r")
            if not line:
                continue
            # pass through only data: lines to the client
            if line.startswith("data:"):
                yield line + "\n\n"


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
    """Non-streaming chat completion that persists user+assistant turns to Postgres."""

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
    model = payload.get("model")
    max_tokens = int(payload.get("max_tokens", 512))
    temperature = float(payload.get("temperature", 0.2))

    if not isinstance(conversation_id, str) or not conversation_id:
        return jsonify({"error": "Missing 'conversation_id'"}), 400
    if not isinstance(user_content, str) or not user_content.strip():
        return jsonify({"error": "Missing 'message'"}), 400

    now = _now_ms()

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

        try:
            assistant_content, resolved_model = _openrouter_chat(
                config=config,
                model=model,
                messages=messages,
                max_tokens=max_tokens,
                temperature=temperature,
            )
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        except requests.Timeout:
            return jsonify({"error": "Upstream timeout"}), 504
        except Exception as e:
            return jsonify({"error": str(e)}), 500

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
                "model": resolved_model,
            }
        )
    # (timing omitted)


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
    model = payload.get("model")
    max_tokens = int(payload.get("max_tokens", 512))
    temperature = float(payload.get("temperature", 0.2))

    if not isinstance(conversation_id, str) or not conversation_id:
        return jsonify({"error": "Missing 'conversation_id'"}), 400
    if not isinstance(user_content, str) or not user_content.strip():
        return jsonify({"error": "Missing 'message'"}), 400

    def gen():
        assistant_text_parts: List[str] = []
        resolved_model: Optional[str] = None

        try:
            now = _now_ms()
            with SessionLocal() as db:
                convo = db.get(AgentConversation, conversation_id)
                if not convo or convo.firebase_uid != ident.uid:
                    yield _sse("error", {"error": "Not found"})
                    return

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

                messages = _build_openai_messages_from_db(db, uid=ident.uid, conversation_id=conversation_id)

            # stream from OpenRouter outside the DB session.
            for line in _openrouter_stream(
                config=config,
                model=model,
                messages=messages,
                max_tokens=max_tokens,
                temperature=temperature,
            ):
                # line is like: data: {...}\n\n
                data_part = line[len("data:") :].strip()
                if data_part == "[DONE]":
                    break
                try:
                    obj = json.loads(data_part)
                except Exception:
                    continue

                if resolved_model is None:
                    resolved_model = obj.get("model") or (model or config.openrouter_model)

                try:
                    delta = (
                        obj.get("choices", [])[0]
                        .get("delta", {})
                        .get("content")
                    )
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
                        "model": resolved_model,
                    },
                )

        except ValueError as e:
            yield _sse("error", {"error": str(e)})
        except requests.Timeout:
            yield _sse("error", {"error": "Upstream timeout"})
        except Exception as e:
            yield _sse("error", {"error": str(e)})

    return Response(gen(), mimetype="text/event-stream")
