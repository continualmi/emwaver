## EMWaver Backend (Flask)

This folder hosts a minimal HTTP backend used by the apps for agent chat.

This backend is also the home for **cloud sync** (scripts + signals). Login is **optional**: apps must continue to work fully without sign-in; when signed in, the app syncs/backs up to cloud.

Endpoints

- `GET /health` -> `{ "ok": true }`
- `POST /api/agent/chat` -> `{ "content": "...", "model": "..." }`

Cloud sync (v1)

Files are stored in **Azure Blob Storage**. Postgres/SQLite stores metadata + indexing.

- `GET /v1/files?kind=...&ext=...` (metadata only)
- `GET /v1/files/<id>` (metadata only)
- `POST /v1/files/init-upload` -> `{ file, upload_url }`
- `POST /v1/files/<id>/commit-upload` (requires `etag`)
- `GET /v1/files/<id>/download` -> `{ download_url }`
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
- `DATABASE_URL` (optional, default: `sqlite:///./emwaver.db`) - Azure Postgres in prod (use `postgresql+psycopg://...`)

Azure Blob storage

- `AZURE_STORAGE_ACCOUNT` (required in prod)
- `AZURE_STORAGE_KEY` (required in prod; prefer Azure Key Vault in deployment)
- `AZURE_BLOB_CONTAINER` (optional, default: `emwaver-user-files`)

Env loading

- On startup the backend loads `<repo_root>/.env` automatically (and optionally `backend/.env`), without overriding existing environment variables.

Run locally

1) Create a venv + install deps:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r ../requirements.txt

# Postgres driver
#
# If DATABASE_URL points at Postgres, you must install the Postgres driver.
# This repo uses psycopg3 (psycopg[binary]) by default.
# (No longer needed) Postgres driver is included in repo-root requirements.txt now.
# pip install -r ../requirements-postgres.txt
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
 - For Azure later: this app is compatible with `gunicorn` (see `requirements.txt`).

Auth note

- For v1, the backend expects `Authorization: Bearer <firebase_id_token>` on cloud sync endpoints.
- For local dev, you can set `EMWAVER_AUTH_MODE=disabled` to bypass auth.
