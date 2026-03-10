# EMWaver Backend (`/backend`)

Flask backend for EMWaver cloud features (a **Continual MI** project):
- auth and identity-bound APIs,
- file sync storage APIs,
- agent chat/message persistence,
- host session presence + WebSocket relay,
- device minting/provisioning and authenticity endpoints,
- store/billing/entitlements endpoints.

This service is deployed to Azure Container Apps and is authoritative for cloud entitlements, minting policy, and account-bound operations.

Policy notes:
- **Backend is authoritative**: apps may gate UI/UX, but server-side checks are the security boundary for minting, Pro/entitlements, and cloud feature access.
- **Minting is the platform activation gate**: all supported boards must be minted (paid) through the backend before they receive platform/cloud access.

---

## 1) Folder purpose

`/backend` contains the production backend implementation and entrypoints:

- `app.py` / `wsgi.py` entry stubs.
- `emw_backend/` package with all runtime code.
- `Dockerfile` for containerized deployment.

The core app factory is `emw_backend/app.py:create_app()`.

---

## 2) High-level architecture

### 2.1 App boot sequence

`create_app()` does:
1. best-effort `.env` loading (`backend/.env`, then repo `.env`) for local dev,
2. parse runtime config from environment (`Config.from_env()`),
3. configure CORS,
4. initialize DB,
5. register REST blueprints,
6. attach WebSocket endpoint (`/v1/ws`) via `flask-sock`.

### 2.2 Main code modules

- `config.py` — environment model and parsing.
- `auth.py` — Firebase token verification / identity extraction.
- `db.py`, `models.py` — SQLAlchemy setup and schema models.
- `storage_azure.py` — Azure Blob helpers (for storage integrations/migrations).
- `agent_*` files — agent prompt/tool logic and schemas.
- `routes/*.py` — HTTP route groups and WebSocket router.

---

## 3) Route map (current)

Registered route modules in `emw_backend/routes/`:

- `health.py` — health + runtime config diagnostics.
- `files.py` — user file list/upload/download/delete.
- `agent.py`, `agent_messages.py` — conversation + message APIs, chat/streaming.
- `hosts.py` — host session heartbeat/listing.
- `ws.py` — authenticated WebSocket relay between web controllers and hosts.
- `devices.py` — attach/list/label minted devices.
- `provisioning.py` — mint DeviceID+Proof (paid platform activation endpoint).
- `entitlements.py`, `pro.py`, `credits.py`, `billing.py`, `store.py` — Pro/store/billing flows.
- `auth_handoff.py` — auth bridge/handoff endpoints.
- `society.py` — additional product-specific API surface.
- `admin.py` — admin operations.
- `docs.py` — API docs routes.

---

## 4) Auth and identity model

Auth is Firebase-token-based for protected APIs.

- Bearer token expected on HTTP endpoints that require identity.
- WS endpoint allows either `Authorization: Bearer ...` or `?token=...` (browser WS limitation).
- User-scoped data is keyed by Firebase UID.

`/health/config` exposes non-secret readiness flags to debug deployment state (auth/storage env readiness).

---

## 5) File sync API behavior

Implemented in `routes/files.py` (`/v1/*`).

Current model (important):
- File metadata **and bytes** are currently persisted in DB (`UserFileIndex.content`).
- APIs are auth-scoped per user UID.
- Flat namespace by filename (no slash paths yet).
- Upsert behavior for upload (Postgres/SQLite conflict handling).

Safety rule migrated from AGENTS:
- `script_bootstrap.emw` is internal engine/bootstrap logic and must never be treated as a user script for cloud upload/sync/share.

Key endpoints:
- `GET /v1/files`
- `GET /v1/files/content?name=...`
- `POST /v1/files/upload`
- `DELETE /v1/files?name=...`

Defensive behaviors present:
- filename sanitization,
- duplicate-row cleanup for legacy states,
- strict base64 validation for uploads.

---

## 6) Remote hosts + WS relay

### 6.1 Host presence

`routes/hosts.py`:
- `POST /v1/hosts/heartbeat` upserts host session state.
- `GET /v1/hosts` returns host sessions for authenticated user.
- Includes dedupe logic by machine fingerprint (`platform|device_name`) to collapse stale duplicates.

### 6.2 WebSocket transport

`routes/ws.py` exposes `/v1/ws`.

Handshake model:
1. authenticate token,
2. first message must be `hello` with role `host` or `web`,
3. host must provide known `hostSessionId`,
4. router binds host<->web flows by user uid + host session id.

Message routing:
- web -> host: forwarded when host is online.
- host -> subscribed web clients: broadcast to current subscribers.
- router tracks latest `script.started` and `ui.snapshot` in memory for tooling/observability.

Operational caveat:
- WS state is in-memory; multi-instance deployments need sticky/session-aware strategy or shared state layer for full cross-instance routing.

---

## 7) Device minting + authenticity

### 7.1 Minting endpoint

`routes/provisioning.py` (`/provisioning/mint`):
- signs random 16-byte DeviceID with root ed25519 private key,
- returns `{device_id_b64, proof_b64}`,
- gated by payment verification and minting policy (rate limits, per-user caps).

Minting is the platform entry point. Users pay to mint a supported board, which activates it as an EMWaver device with full platform access.

Policy notes:
- Device attach/verification requires forwarding `DeviceID + Proof` to backend; backend repeats verification and enforces policy.
- Pro purchase eligibility depends on signed-in user having at least one minted device attached.

Environment gates:
- `EMWAVER_PROVISIONING_ENABLED`
- `EMWAVER_PROVISIONING_ALLOWED_UIDS` (operator override / internal use)
- `EMWAVER_PROVISIONING_ROOT_PRIVATE_KEY_B64`
- optional mint RPM limit.

### 7.2 Device attach/verify endpoints

`routes/devices.py` (`/v1/devices/*`):
- verifies Proof against root public key (`EMWAVER_ROOT_PUBLIC_KEY_B64`),
- allows attach/seen/list/label flows,
- prevents re-claim of already-attached device by another user.

---

## 8) Configuration reference

`Config.from_env()` keys include:

Core:
- `DATABASE_URL`
- `CORS_ORIGINS`

Auth:
- `FIREBASE_PROJECT_ID`
- `EMWAVER_AUTH_DEBUG`

Provisioning:
- `EMWAVER_PROVISIONING_ENABLED`
- `EMWAVER_PROVISIONING_ROOT_PRIVATE_KEY_B64`
- `EMWAVER_PROVISIONING_ALLOWED_UIDS`
- `EMWAVER_PROVISIONING_ALLOWED_EMAIL` (legacy fallback)
- `EMWAVER_PROVISIONING_MINT_RPM`

Device authenticity:
- `EMWAVER_ROOT_PUBLIC_KEY_B64`

OpenAI-compatible agent upstream:
- `OPENAI_BASE_URL`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`

Azure storage:
- `AZURE_STORAGE_ACCOUNT`
- `AZURE_STORAGE_KEY`
- `AZURE_BLOB_CONTAINER`

Store/pro billing:
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STORE_STRIPE_PRICE_ID`, `STORE_SUCCESS_URL`, `STORE_CANCEL_URL`, `STORE_SHIPPING_COUNTRIES`
- `PRO_STRIPE_PRICE_ID`, `PRO_SUCCESS_URL`, `PRO_CANCEL_URL`

---

## 9) Local development

From repo root:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cd backend
python app.py
```

Default local port is configured by app/env (commonly `8787`).

If running frontend locally, point frontend backend URL settings to this backend.

---

## 10) Deployment model

- Containerized Flask app (`backend/Dockerfile`).
- Deployed on Azure Container Apps.
- CI/CD handled via repo GitHub Actions workflows (see root/AGENTS docs for pipeline refs).

---

## 11) Guardrails for contributors

1. Any new endpoint must be user/tenant scoped where applicable.
2. Cloud entitlements must be enforced server-side (not UI-only).
3. Keep `/health/config` non-sensitive (flags only, never secrets).
4. Keep route docs updated here whenever APIs change.
5. For WebSocket protocol changes, update both backend and all host/controller clients in lockstep.
