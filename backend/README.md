## EMWaver Backend (Flask)

This folder hosts a minimal HTTP backend used by the apps for agent chat.

Endpoints

- `GET /health` -> `{ "ok": true }`
- `POST /api/agent/chat` -> `{ "content": "...", "model": "..." }`

Environment

- `OPENROUTER_API_KEY` (required) - server-side key custody
- `OPENROUTER_MODEL` (optional, default: `x-ai/grok-4.1-fast`)
- `CORS_ORIGINS` (optional, default: `*`) - comma-separated
- `PORT` (optional, default: `8787`)

Env loading

- On startup the backend loads `<repo_root>/.env` automatically (and optionally `backend/.env`), without overriding existing environment variables.

Run locally

1) Create a venv + install deps:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

2) Export env vars (or use your shell env manager):

```bash
export OPENROUTER_API_KEY=...
export CORS_ORIGINS=tauri://localhost,http://localhost
```

3) Start the server:

```bash
python app.py
```

Wire the desktop Agent tab

- Set `VITE_EMWAVER_BACKEND_URL` to point at this server (default is `http://127.0.0.1:8787`).

Example:

```bash
export VITE_EMWAVER_BACKEND_URL=http://127.0.0.1:8787
```

Notes

- This is a development-friendly starting point. Auth/accounts/sync/storage are not implemented yet.
- For Azure later: this app is compatible with `gunicorn` (see `requirements.txt`).
