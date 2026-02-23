# Secrets / Env Source of Truth

This document is the contract.

- Every variable is listed below with its **single canonical definition file**.
- Each platform/host has an explicit list of env files it must load.
- Platforms should load **only** the files listed for that platform.
- Goal: **no duplicated keys across env files**.

---

## 1) Canonical variable map (variable -> file)

### shared/core.env
- `EMWAVER_BACKEND_URL`
- `EMWAVER_FRONTEND_URL`
- `EMWAVER_ALLOW_ANON_SYNC`
- `EMWAVER_ROOT_PUBLIC_KEY_B64`

### shared/firebase.env
- `FIREBASE_PROJECT_ID`
- `FIREBASE_API_KEY`
- `FIREBASE_AUTH_DOMAIN`
- `FIREBASE_APP_ID`
- `EMWAVER_FIREBASE_WEB_API_KEY` (alias from `FIREBASE_API_KEY`)

### shared/oauth.env
- `EMWAVER_GOOGLE_CLIENT_ID`
- `EMWAVER_GOOGLE_CLIENT_SECRET`
- `EMWAVER_GOOGLE_REDIRECT_URI`

### server/backend.env
- `EMWAVER_AUTH_MODE`
- `EMWAVER_AUTH_DEBUG`
- `CORS_ORIGINS`
- `PORT`
- `FLASK_APP`
- `DATABASE_URL`
- `FIREBASE_ADMIN_JSON_B64`
- `FIREBASE_SERVICE_ACCOUNT_JSON`

### server/ai.env
- `OPENROUTER_API_KEY`
- `OPENAI_API_KEY`
- `OPENAI_BASE_URL`
- `OPENAI_MODEL`
- `GEMINI_API_KEY`

### server/billing.env
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STORE_STRIPE_PRICE_ID`
- `STORE_SUCCESS_URL`
- `STORE_CANCEL_URL`
- `STORE_SHIPPING_COUNTRIES`
- `PRO_STRIPE_PRICE_ID`
- `PRO_SUCCESS_URL`
- `PRO_CANCEL_URL`

### server/storage.env
- `AZURE_STORAGE_ACCOUNT`
- `AZURE_STORAGE_KEY`
- `AZURE_BLOB_CONTAINER`
- `AZURE_STORAGE_CONNECTION_STRING`
- `AZURE_STORAGE_CONTAINER`

### server/provisioning.env
- `EMWAVER_PROVISIONING_ENABLED`
- `EMWAVER_PROVISIONING_ROOT_PRIVATE_KEY_B64`
- `EMWAVER_PROVISIONING_ALLOWED_UIDS`
- `EMWAVER_PROVISIONING_ALLOWED_EMAIL`
- `EMWAVER_PROVISIONING_MINT_RPM`

### targets/frontend.env
- `NEXT_PUBLIC_EMWAVER_BACKEND_URL`
- `NEXT_PUBLIC_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
- `NEXT_PUBLIC_FIREBASE_APP_ID`
- `NODE_ENV`

### targets/securewaver.env
- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_APP_ID`

### targets/daemon.env
- `EMWAVER_ID_TOKEN`
- `EMWAVER_HOST_SESSION_ID`
- `EMWAVER_BOOTSTRAP_PATH`
- `RUST_LOG`

### targets/apps.env
- _(currently empty by design; reserved for future native-app-only keys)_

### ci/azure.env
- `AZURE_CLIENT_ID`
- `AZURE_CLIENT_SECRET`
- `AZURE_TENANT_ID`
- `AZURE_SUBSCRIPTION_ID`
- `AZURE_RESOURCE_GROUP`
- `AZURE_ACR_NAME`
- `AZURE_ACR_LOGIN_SERVER`
- `AZURE_BACKEND_IMAGE_NAME`
- `AZURE_FRONTEND_IMAGE_NAME`
- `AZURE_BACKEND_APP_NAME`
- `AZURE_FRONTEND_APP_NAME`
- `GH_AUTH_TOKEN`

---

## 2) Required file set per platform/host

Load files in this order.

### Backend API (Flask)
1. `secrets/shared/core.env`
2. `secrets/shared/firebase.env`
3. `secrets/server/backend.env`
4. `secrets/server/ai.env`
5. `secrets/server/billing.env`
6. `secrets/server/storage.env`
7. `secrets/server/provisioning.env`

### Frontend (Next.js)
1. `secrets/shared/core.env`
2. `secrets/shared/firebase.env`
3. `secrets/targets/frontend.env`

### Native apps (iOS, macOS, Android, Windows)
1. `secrets/shared/core.env`
2. `secrets/shared/firebase.env`
3. `secrets/shared/oauth.env`
4. `secrets/targets/apps.env`

### SecureWaver (Tauri)
1. `secrets/shared/core.env`
2. `secrets/shared/firebase.env`
3. `secrets/shared/oauth.env`
4. `secrets/targets/securewaver.env`

### Daemon / Headless host
1. `secrets/shared/core.env`
2. `secrets/targets/daemon.env`

### CI/CD (Azure deploy)
1. `secrets/ci/azure.env`

---

## 3) Hard boundaries

- `EMWAVER_PROVISIONING_ROOT_PRIVATE_KEY_B64` is **server-only** (never ship to client bundles/apps).
- `NEXT_PUBLIC_*` and `VITE_*` are **public build-time** values (compiled into clients).
- `EMWAVER_ROOT_PUBLIC_KEY_B64` is public by design and safe for clients.
