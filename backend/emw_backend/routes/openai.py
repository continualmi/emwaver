from __future__ import annotations

import json
from typing import Any, Dict

import requests
from flask import Blueprint, Response, current_app, jsonify, request

from emw_backend.config import Config


openai_bp = Blueprint("openai", __name__)


def _join_url(base: str, path: str) -> str:
    b = (base or "").strip().rstrip("/")
    p = (path or "").strip()
    if not p.startswith("/"):
        p = "/" + p
    return b + p


def _require_openai_upstream(config: Config):
    if not config.openai_base_url:
        raise RuntimeError("Missing OPENAI_BASE_URL")


def _upstream_headers(config: Config) -> Dict[str, str]:
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": "EMWaver/backend",
    }
    if config.openai_api_key:
        headers["Authorization"] = f"Bearer {config.openai_api_key}"
    return headers


@openai_bp.post("/v1/chat/completions")
def chat_completions_proxy():
    """OpenAI-compatible proxy.

    - Upstream base URL is configured via OPENAI_BASE_URL (e.g. https://api.openai.com/v1)
    - Model is forced from OPENAI_MODEL if set.
    - Supports stream=true (SSE pass-through).

    This endpoint intentionally does not persist messages; it is a plain proxy.
    """

    config: Config = current_app.config["EMWAVER_CONFIG"]
    try:
        _require_openai_upstream(config)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    payload = request.get_json(force=True, silent=False)
    if not isinstance(payload, dict):
        return jsonify({"error": "Invalid JSON payload"}), 400

    if config.openai_model:
        payload["model"] = config.openai_model

    upstream_url = _join_url(config.openai_base_url, "/chat/completions")
    stream = bool(payload.get("stream"))

    try:
        if not stream:
            resp = requests.post(
                upstream_url,
                json=payload,
                headers=_upstream_headers(config),
                timeout=90,
            )
            return Response(resp.content, status=resp.status_code, mimetype=resp.headers.get("Content-Type", "application/json"))

        # stream=true: pass through SSE
        def gen():
            with requests.post(
                upstream_url,
                json=payload,
                headers={**_upstream_headers(config), "Accept": "text/event-stream"},
                timeout=90,
                stream=True,
            ) as resp:
                if resp.status_code < 200 or resp.status_code >= 300:
                    # emit a single error event to help clients
                    try:
                        body = resp.text
                    except Exception:
                        body = ""
                    err = {"error": f"Upstream error ({resp.status_code}): {body}"}
                    yield f"event: error\ndata: {json.dumps(err, ensure_ascii=False)}\n\n"
                    return

                for raw in resp.iter_lines(decode_unicode=True):
                    if raw is None:
                        continue
                    line = raw.strip("\r")
                    if not line:
                        continue
                    # forward SSE lines exactly
                    yield line + "\n"

        return Response(gen(), mimetype="text/event-stream")

    except requests.Timeout:
        return jsonify({"error": "Upstream timeout"}), 504
    except Exception as e:
        return jsonify({"error": str(e)}), 500
