import os
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

import requests
from flask import Flask, jsonify, request
from flask_cors import CORS


OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"


def _load_dotenv_from_repo_root() -> None:
    # backend/app.py lives at: <repo_root>/backend/app.py
    # Prefer loading the repo root .env for local dev.
    def load_env_file(path: Path) -> None:
        if not path.exists() or not path.is_file():
            return
        try:
            raw = path.read_text(encoding="utf-8")
        except Exception:
            return

        for line in raw.splitlines():
            s = line.strip()
            if not s or s.startswith("#"):
                continue
            if s.startswith("export "):
                s = s[len("export ") :].strip()
            if "=" not in s:
                continue
            k, v = s.split("=", 1)
            key = k.strip()
            if not key:
                continue

            val = v.strip()
            if (val.startswith("\"") and val.endswith("\"")) or (val.startswith("'") and val.endswith("'")):
                val = val[1:-1]

            # Do not override existing environment variables.
            os.environ.setdefault(key, val)

    repo_root = Path(__file__).resolve().parent.parent
    load_env_file(repo_root / ".env")
    # Optional backend-local .env (e.g. for Azure or local overrides).
    load_env_file(Path(__file__).resolve().parent / ".env")


_load_dotenv_from_repo_root()


def _env(key: str, default: Optional[str] = None) -> Optional[str]:
    v = os.environ.get(key)
    if v is None:
        return default
    v = v.strip()
    return v if v else default


def _cors_origins() -> Union[List[str], str]:
    origins = _env("CORS_ORIGINS", "*") or "*"
    if origins == "*":
        return "*"
    return [o.strip() for o in origins.split(",") if o.strip()]


app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": _cors_origins()}})


@app.get("/health")
def health():
    return jsonify({"ok": True})


def _openrouter_chat(payload: Dict[str, Any]) -> Dict[str, Any]:
    api_key = _env("OPENROUTER_API_KEY")
    if not api_key:
        raise RuntimeError("Missing OPENROUTER_API_KEY")

    model = payload.get("model") or _env("OPENROUTER_MODEL", "x-ai/grok-4.1-fast")
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
            "Authorization": f"Bearer {api_key}",
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
        content = (
            data.get("choices", [])[0]
            .get("message", {})
            .get("content", "")
            .strip()
        )
    except Exception:
        content = None

    if not content:
        raise RuntimeError("OpenRouter response missing message content")

    return {
        "content": content,
        "model": data.get("model") or model,
    }


@app.post("/api/agent/chat")
def agent_chat():
    started = time.time()
    try:
        payload = request.get_json(force=True, silent=False)
        if not isinstance(payload, dict):
            return jsonify({"error": "Invalid JSON payload"}), 400

        result = _openrouter_chat(payload)
        return jsonify(result)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except requests.Timeout:
        return jsonify({"error": "Upstream timeout"}), 504
    except Exception as e:
        # Keep errors readable for dev; do not leak secrets.
        return jsonify({"error": str(e)}), 500
    finally:
        _ = time.time() - started


if __name__ == "__main__":
    port = int(_env("PORT", "8787") or "8787")
    app.run(host="127.0.0.1", port=port, debug=True)
