from __future__ import annotations

import json
import time
from typing import Any, Dict, Iterable, List, Optional

from flask import Blueprint, Response, current_app, jsonify, request
from openai import OpenAI
import requests

from emw_backend.agent_prompt import load_repo_agent_system_prompt
from emw_backend.agent_tool_schema import tool_schemas_v1
from emw_backend.agent_tools import (
    ToolError,
    hosts_list,
    remote_attach,
    remote_run_script,
    remote_send_ui_event,
    remote_wait_for_ui,
)
from emw_backend.routes.ws import _router
from sqlalchemy import desc, select

from emw_backend.auth import verify_request_identity
from emw_backend.config import Config
from emw_backend.db import SessionLocal
from emw_backend.models import AgentChatGptCredential, AgentConversation, AgentMessage, AgentUserSettings


agent_bp = Blueprint("agent", __name__)


# ChatGPT Plus/Pro (Codex) OAuth + API endpoints (matches anomalyco/opencode).
_CHATGPT_OAUTH_ISSUER = "https://auth.openai.com"
_CHATGPT_OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"
_CHATGPT_CODEX_RESPONSES_URL = "https://chatgpt.com/backend-api/codex/responses"
_CHATGPT_TOKEN_REFRESH_SAFETY_MARGIN_MS = 3000


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


def _get_agent_llm_provider(db, *, uid: str) -> str:
    settings = db.get(AgentUserSettings, uid)
    if settings and settings.llm_provider in ("chatgpt", "platform"):
        return settings.llm_provider
    # Default to chatgpt when credentials exist; otherwise platform.
    cred = db.get(AgentChatGptCredential, uid)
    return "chatgpt" if (cred and cred.refresh_token) else "platform"


def _refresh_chatgpt_access_token(*, refresh_token: str) -> dict:
    # https://auth.openai.com/oauth/token
    resp = requests.post(
        f"{_CHATGPT_OAUTH_ISSUER}/oauth/token",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        data={
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "client_id": _CHATGPT_OAUTH_CLIENT_ID,
        },
        timeout=30,
    )
    if resp.status_code // 100 != 2:
        raise RuntimeError(f"ChatGPT token refresh failed (HTTP {resp.status_code}): {resp.text[:400]}")
    return resp.json()


def _chatgpt_get_valid_access_token(db, *, uid: str) -> tuple[str, str | None]:
    cred = db.get(AgentChatGptCredential, uid)
    if not cred or not cred.refresh_token:
        raise RuntimeError("ChatGPT not connected")

    now = _now_ms()
    if cred.access_token and cred.expires_at_ms and cred.expires_at_ms > (now + _CHATGPT_TOKEN_REFRESH_SAFETY_MARGIN_MS):
        return cred.access_token, cred.chatgpt_account_id

    tok = _refresh_chatgpt_access_token(refresh_token=cred.refresh_token)

    access = tok.get("access_token")
    refresh = tok.get("refresh_token") or cred.refresh_token
    expires_in = tok.get("expires_in")

    if not isinstance(access, str) or not access:
        raise RuntimeError("ChatGPT token refresh returned no access_token")

    expires_at_ms = None
    if isinstance(expires_in, (int, float)):
        expires_at_ms = int(now + (float(expires_in) * 1000))

    cred.access_token = access
    cred.refresh_token = refresh
    cred.expires_at_ms = expires_at_ms
    cred.updated_at_ms = now
    db.add(cred)
    db.commit()

    return access, cred.chatgpt_account_id


def _chatgpt_codex_chat_completions_create(
    *,
    access_token: str,
    account_id: str | None,
    model: str,
    messages: list[dict],
    tools: list[dict] | None,
    max_tokens: int,
    temperature: float,
) -> dict:
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
        "User-Agent": "emwaver-backend",
        "originator": "emwaver",
    }
    if account_id:
        headers["ChatGPT-Account-Id"] = account_id

    payload: dict = {
        "model": model,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": temperature,
    }
    if tools is not None:
        payload["tools"] = tools

    resp = requests.post(_CHATGPT_CODEX_RESPONSES_URL, headers=headers, json=payload, timeout=90)
    if resp.status_code // 100 != 2:
        raise RuntimeError(f"ChatGPT Codex request failed (HTTP {resp.status_code}): {resp.text[:400]}")
    return resp.json()


def _sse(event: str, data: Any) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


# --- Agent provider settings ---


@agent_bp.get("/v1/agent/llm_provider")
def get_llm_provider():
    config: Config = current_app.config["EMWAVER_CONFIG"]
    ident, err = _require_identity(config)
    if err:
        return err

    with SessionLocal() as db:
        settings = db.get(AgentUserSettings, ident.uid)
        if not settings:
            settings = AgentUserSettings(firebase_uid=ident.uid, llm_provider="chatgpt", created_at_ms=_now_ms(), updated_at_ms=_now_ms())
            db.add(settings)
            db.commit()

        cred = db.get(AgentChatGptCredential, ident.uid)
        chatgpt_connected = bool(cred and cred.refresh_token)

        return jsonify(
            {
                "llm_provider": settings.llm_provider,
                "chatgpt_connected": chatgpt_connected,
                # Best-effort hints for the UI.
                "chatgpt_account_id": (cred.chatgpt_account_id if cred else None),
            }
        )


@agent_bp.post("/v1/agent/llm_provider")
def set_llm_provider():
    config: Config = current_app.config["EMWAVER_CONFIG"]
    ident, err = _require_identity(config)
    if err:
        return err

    payload = request.get_json(force=True, silent=True) or {}
    if not isinstance(payload, dict):
        return jsonify({"error": "Invalid JSON payload"}), 400

    provider = payload.get("llm_provider")
    if provider not in ("chatgpt", "platform"):
        return jsonify({"error": "Invalid 'llm_provider' (expected 'chatgpt' or 'platform')"}), 400

    now = _now_ms()
    with SessionLocal() as db:
        settings = db.get(AgentUserSettings, ident.uid)
        if not settings:
            settings = AgentUserSettings(firebase_uid=ident.uid, llm_provider=provider, created_at_ms=now, updated_at_ms=now)
        else:
            settings.llm_provider = provider
            settings.updated_at_ms = now
        db.add(settings)
        db.commit()

    return jsonify({"ok": True, "llm_provider": provider})


@agent_bp.post("/v1/agent/chatgpt_oauth")
def set_chatgpt_oauth_tokens():
    """Store ChatGPT/Codex OAuth tokens for the authenticated user.

    The client performs the OAuth flow (browser/device) and sends the resulting tokens here.
    The backend persists the refresh token and can refresh access tokens as needed.
    """

    config: Config = current_app.config["EMWAVER_CONFIG"]
    ident, err = _require_identity(config)
    if err:
        return err

    payload = request.get_json(force=True, silent=False)
    if not isinstance(payload, dict):
        return jsonify({"error": "Invalid JSON payload"}), 400

    refresh_token = payload.get("refresh_token")
    access_token = payload.get("access_token")
    expires_at_ms = payload.get("expires_at_ms")
    chatgpt_account_id = payload.get("chatgpt_account_id")

    if not isinstance(refresh_token, str) or not refresh_token:
        return jsonify({"error": "Missing 'refresh_token'"}), 400

    if access_token is not None and not isinstance(access_token, str):
        return jsonify({"error": "Invalid 'access_token'"}), 400
    if expires_at_ms is not None and not isinstance(expires_at_ms, int):
        return jsonify({"error": "Invalid 'expires_at_ms'"}), 400
    if chatgpt_account_id is not None and not isinstance(chatgpt_account_id, str):
        return jsonify({"error": "Invalid 'chatgpt_account_id'"}), 400

    now = _now_ms()

    with SessionLocal() as db:
        cred = db.get(AgentChatGptCredential, ident.uid)
        if not cred:
            cred = AgentChatGptCredential(
                firebase_uid=ident.uid,
                refresh_token=refresh_token,
                access_token=(access_token or None),
                expires_at_ms=expires_at_ms,
                chatgpt_account_id=(chatgpt_account_id or None),
                created_at_ms=now,
                updated_at_ms=now,
            )
        else:
            cred.refresh_token = refresh_token
            cred.access_token = (access_token or None)
            cred.expires_at_ms = expires_at_ms
            cred.chatgpt_account_id = (chatgpt_account_id or None)
            cred.updated_at_ms = now

        db.add(cred)

        # Ensure settings row exists; default to chatgpt when tokens are set.
        settings = db.get(AgentUserSettings, ident.uid)
        if not settings:
            settings = AgentUserSettings(firebase_uid=ident.uid, llm_provider="chatgpt", created_at_ms=now, updated_at_ms=now)
        else:
            settings.updated_at_ms = now
        db.add(settings)

        db.commit()

    return jsonify({"ok": True})


@agent_bp.delete("/v1/agent/chatgpt_oauth")
def delete_chatgpt_oauth_tokens():
    config: Config = current_app.config["EMWAVER_CONFIG"]
    ident, err = _require_identity(config)
    if err:
        return err

    with SessionLocal() as db:
        cred = db.get(AgentChatGptCredential, ident.uid)
        if cred:
            db.delete(cred)
            db.commit()

    return jsonify({"ok": True})


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


@agent_bp.delete("/v1/agent/conversations/<conversation_id>")
def delete_conversation(conversation_id: str):
    """Delete a conversation and all its messages (owned by the authenticated user)."""

    config: Config = current_app.config["EMWAVER_CONFIG"]
    ident, err = _require_identity(config)
    if err:
        return err

    with SessionLocal() as db:
        convo = db.get(AgentConversation, conversation_id)
        if not convo or convo.firebase_uid != ident.uid:
            return jsonify({"error": "Not found"}), 404

        # Delete messages first (FK may not be cascade).
        db.execute(
            AgentMessage.__table__.delete().where(AgentMessage.conversation_id == conversation_id).where(AgentMessage.firebase_uid == ident.uid)
        )
        db.delete(convo)
        db.commit()

    return jsonify({"ok": True})


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

    resp = Response(gen(), mimetype="text/event-stream")
    resp.headers["Cache-Control"] = "no-cache"
    resp.headers["X-Accel-Buffering"] = "no"
    return resp


@agent_bp.post("/v1/agent/chat/stream_tools")
def agent_chat_stream_tools():
    """SSE chat endpoint with server-side OpenAI tool calling (v1).

    This endpoint is intentionally simple:
    - It performs tool-calling loops server-side.
    - It streams only the final assistant text (best-effort).

    SSE events:
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
    max_tokens = int(payload.get("max_tokens", 700))
    temperature = float(payload.get("temperature", 0.2))

    if not isinstance(conversation_id, str) or not conversation_id:
        return jsonify({"error": "Missing 'conversation_id'"}), 400
    if not isinstance(user_content, str) or not user_content.strip():
        return jsonify({"error": "Missing 'message'"}), 400

    def gen() -> Iterable[str]:
        started = time.time()

        try:
            now = _now_ms()
            with SessionLocal() as db:
                convo = db.get(AgentConversation, conversation_id)
                if not convo or convo.firebase_uid != ident.uid:
                    yield _sse("error", {"error": "Not found"})
                    return

                provider = _get_agent_llm_provider(db, uid=ident.uid)

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

            client = _require_openai(config) if provider == "platform" else None

            # Prepend repo-wide system prompt if available.
            sys_prompt = load_repo_agent_system_prompt()
            if sys_prompt:
                messages = [{"role": "system", "content": sys_prompt}] + messages

            tools = tool_schemas_v1()

            # Tool loop (non-streaming per step).
            # Emit an initial event so the client UI shows activity even while the model thinks.
            yield ": connected\n\n"

            tool_iterations = 0
            assistant_text: str = ""

            while tool_iterations < 8:
                tool_iterations += 1
                if provider == "platform":
                    resp = client.chat.completions.create(
                        model=config.openai_model,
                        messages=messages,
                        max_tokens=max_tokens,
                        temperature=temperature,
                        tools=tools,
                    )
                    msg = resp.choices[0].message
                    tool_calls = getattr(msg, "tool_calls", None)
                else:
                    with SessionLocal() as db:
                        access, account_id = _chatgpt_get_valid_access_token(db, uid=ident.uid)
                    resp = _chatgpt_codex_chat_completions_create(
                        access_token=access,
                        account_id=account_id,
                        model=config.openai_model,
                        messages=messages,
                        tools=tools,
                        max_tokens=max_tokens,
                        temperature=temperature,
                    )
                    choice0 = (resp.get("choices") or [{}])[0] if isinstance(resp, dict) else {}
                    msg = choice0.get("message") if isinstance(choice0, dict) else None
                    tool_calls = (msg or {}).get("tool_calls") if isinstance(msg, dict) else None

                # If the model returned text, keep it (may be final or partial).
                if provider == "platform":
                    if getattr(msg, "content", None):
                        assistant_text = str(msg.content)
                else:
                    if isinstance(msg, dict) and msg.get("content"):
                        assistant_text = str(msg.get("content") or "")

                if not tool_calls:
                    break

                # Normalize tool calls into plain dicts.
                norm_tool_calls: List[Dict[str, Any]] = []
                if provider == "platform":
                    for tc in tool_calls:
                        norm_tool_calls.append(
                            {
                                "id": tc.id,
                                "name": tc.function.name,
                                "arguments": tc.function.arguments,
                            }
                        )
                else:
                    if isinstance(tool_calls, list):
                        for tc in tool_calls:
                            if not isinstance(tc, dict):
                                continue
                            fn = tc.get("function") if isinstance(tc.get("function"), dict) else {}
                            norm_tool_calls.append(
                                {
                                    "id": str(tc.get("id") or ""),
                                    "name": str(fn.get("name") or ""),
                                    "arguments": fn.get("arguments") if fn.get("arguments") is not None else "",
                                }
                            )

                # Append assistant tool call message (OpenAI-compatible shape).
                messages.append(
                    {
                        "role": "assistant",
                        "content": (msg.content if provider == "platform" else (msg.get("content") if isinstance(msg, dict) else "")) or "",
                        "tool_calls": [
                            {
                                "id": tc["id"],
                                "type": "function",
                                "function": {
                                    "name": tc["name"],
                                    "arguments": tc["arguments"],
                                },
                            }
                            for tc in norm_tool_calls
                        ],
                    }
                )

                # Execute tools.
                for tc in norm_tool_calls:
                    tool_name = tc["name"]
                    args_json = tc["arguments"]
                    tool_call_id = tc["id"]

                    # Emit tool call event for UI visibility.
                    yield _sse("tool", {"name": tool_name, "arguments": args_json})

                    try:
                        if tool_name == "hosts_list":
                            out = hosts_list(uid=ident.uid)
                        elif tool_name == "remote_attach":
                            import json as _json
                            args = _json.loads(args_json or "{}")
                            out = remote_attach(uid=ident.uid, hostSessionId=str(args.get("hostSessionId") or ""))
                        elif tool_name == "remote_run_script":
                            import json as _json
                            args = _json.loads(args_json or "{}")
                            out = remote_run_script(
                                uid=ident.uid,
                                hostSessionId=str(args.get("hostSessionId") or ""),
                                name=str(args.get("name") or ""),
                                source=str(args.get("source") or ""),
                            )
                        elif tool_name == "remote_wait_for_ui":
                            import json as _json
                            args = _json.loads(args_json or "{}")
                            out = remote_wait_for_ui(
                                uid=ident.uid,
                                hostSessionId=str(args.get("hostSessionId") or ""),
                                minRev=int(args.get("minRev") or 0),
                                timeoutSeconds=float(args.get("timeoutSeconds") or 10.0),
                            )
                        elif tool_name == "remote_send_ui_event":
                            import json as _json
                            args = _json.loads(args_json or "{}")
                            out = remote_send_ui_event(
                                uid=ident.uid,
                                hostSessionId=str(args.get("hostSessionId") or ""),
                                scriptInstanceId=str(args.get("scriptInstanceId") or ""),
                                targetNodeId=str(args.get("targetNodeId") or ""),
                                name=str(args.get("name") or ""),
                                payload=(args.get("payload") if isinstance(args.get("payload"), dict) else {}),
                                baseRev=(int(args.get("baseRev")) if args.get("baseRev") is not None else None),
                            )
                        else:
                            out = {"error": f"unknown_tool:{tool_name}"}
                    except ToolError as te:
                        out = {"error": te.message}
                    except Exception as e:
                        out = {"error": str(e)}

                    # Emit tool result event for UI visibility.
                    yield _sse("tool", {"name": tool_name, "result": out})

                    messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": tool_call_id,
                            "content": json.dumps(out, ensure_ascii=False),
                        }
                    )

            assistant_text = (assistant_text or "").strip()
            if not assistant_text:
                yield _sse("error", {"error": "Upstream produced no content"})
                return

            # Persist assistant message.
            with SessionLocal() as db:
                convo = db.get(AgentConversation, conversation_id)
                if not convo or convo.firebase_uid != ident.uid:
                    yield _sse("error", {"error": "Not found"})
                    return

                amsg = AgentMessage(
                    conversation_id=conversation_id,
                    firebase_uid=ident.uid,
                    role="assistant",
                    content=assistant_text,
                    created_at_ms=_now_ms(),
                )
                db.add(amsg)
                convo.updated_at_ms = _now_ms()
                db.add(convo)
                db.commit()
                db.refresh(amsg)

                # Stream the final text in chunks (best-effort).
                chunk = 64
                for i in range(0, len(assistant_text), chunk):
                    yield _sse("delta", {"text": assistant_text[i : i + chunk]})

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
                        "tool_iterations": tool_iterations,
                        "elapsed_s": round(time.time() - started, 3),
                    },
                )

        except Exception as e:
            yield _sse("error", {"error": str(e)})

    resp = Response(gen(), mimetype="text/event-stream")
    resp.headers["Cache-Control"] = "no-cache"
    resp.headers["X-Accel-Buffering"] = "no"
    return resp
