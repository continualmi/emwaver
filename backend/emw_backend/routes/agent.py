from __future__ import annotations

import time
from typing import Any, Dict

import requests
from flask import Blueprint, jsonify, request, current_app

from emw_backend.config import Config


OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

agent_bp = Blueprint("agent", __name__)


def _openrouter_chat(payload: Dict[str, Any], config: Config) -> Dict[str, Any]:
    if not config.openrouter_api_key:
        raise RuntimeError("Missing OPENROUTER_API_KEY")

    model = payload.get("model") or config.openrouter_model
    messages = payload.get("messages")
    max_tokens = payload.get("max_tokens", 512)
    temperature = payload.get("temperature", 0.2)

    if not isinstance(model, str) or not model.strip():
        raise ValueError("Invalid 'model'")
    if not isinstance(messages, list) or not messages:
        raise ValueError("Invalid 'messages'")

    req_body = {
        "model": model,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": temperature,
    }

    resp = requests.post(
        OPENROUTER_URL,
        json=req_body,
        headers={
            "Authorization": f"Bearer {config.openrouter_api_key}",
            "X-Title": "EMWaver",
            "User-Agent": "EMWaver/backend",
        },
        timeout=60,
    )

    if resp.status_code < 200 or resp.status_code >= 300:
        raise RuntimeError(f"OpenRouter error ({resp.status_code}): {resp.text}")

    data = resp.json()
    content = None
    try:
        content = data.get("choices", [])[0].get("message", {}).get("content", "").strip()
    except Exception:
        content = None

    if not content:
        raise RuntimeError("OpenRouter response missing message content")

    return {
        "content": content,
        "model": data.get("model") or model,
    }


@agent_bp.post("/api/agent/chat")
def agent_chat():
    started = time.time()
    config: Config = current_app.config["EMWAVER_CONFIG"]
    try:
        payload = request.get_json(force=True, silent=False)
        if not isinstance(payload, dict):
            return jsonify({"error": "Invalid JSON payload"}), 400

        result = _openrouter_chat(payload, config)
        return jsonify(result)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except requests.Timeout:
        return jsonify({"error": "Upstream timeout"}), 504
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        _ = time.time() - started
