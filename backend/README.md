## EMWaver Backend (Flask)

This folder hosts a minimal HTTP backend used by the apps for agent chat.

This backend is also the home for **cloud sync** (scripts + signals). Login is **optional**: apps must continue to work fully without sign-in; when signed in, the app syncs/backs up to cloud.

Endpoints

- `GET /health` -> `{ "ok": true }`
- `POST /api/agent/chat` -> `{ "content": "...", "model": "..." }`

Cloud sync (v1)

- `GET /v1/files?kind=script&ext=.emw&include_content=0|1`
- `GET /v1/files/<id>`
- `POST /v1/files`
- `PUT /v1/files/<id>` (requires `etag`)
- `POST /v1/files/<id>/rename`
- `DELETE /v1/files/<id>?etag=...`

Environment

- `OPENROUTER_API_KEY` (required) - server-side key custody
- `OPENROUTER_MODEL` (optional, default: `x-ai/grok-4.1-fast`)
- `CORS_ORIGINS` (optional, default: `*`) - comma-separated
- `PORT` (optional, default: `8787`)

Auth / cloud sync

- `FIREBASE_PROJECT_ID` (required for auth in prod) - used to verify Firebase ID tokens
- `EMWAVER_AUTH_MODE` (optional, default: `firebase`) - set to `disabled` for local dev without auth
- `DATABASE_URL` (optional, default: `sqlite:///./emwaver.db`) - Azure Postgres in prod

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
export CORS_ORIGINS=http://localhost,http://127.0.0.1
```

3) Start the server:

```bash
python app.py
```

Client integration (optional)

- Point your client at `http://127.0.0.1:8787`.

Notes

- This is a development-friendly starting point. Cloud sync endpoints exist, but client-side sync UX is still evolving.
- For Azure later: this app is compatible with `gunicorn` (see `requirements.txt`).

Auth note

- For v1, the backend expects `Authorization: Bearer <firebase_id_token>` on cloud sync endpoints.
- For local dev, you can set `EMWAVER_AUTH_MODE=disabled` to bypass auth.
