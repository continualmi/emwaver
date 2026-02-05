# Azure Deployment (Container Apps)

This repo supports deploying **backend** + **frontend (Next.js)** to **Azure Container Apps**.

## Overview

- **Backend**: Flask API (container)
- **Frontend**: Next.js (container, runs `next start`)
- **Registry**: Azure Container Registry (ACR)
- **Deploy**: GitHub Actions with Azure OIDC login

> Note: `NEXT_PUBLIC_*` variables are baked into the Next.js bundle at **build time**.
> The workflow passes them as Docker build args.

---

## 1) Azure Portal: create resources

### A) Create Resource Group

Azure Portal → Resource groups → Create
- Name: `emwaver-rg` (or similar)
- Region: choose one (e.g. West Europe)

### B) Create Azure Container Registry (ACR)

Azure Portal → Container registries → Create
- Resource group: `emwaver-rg`
- Name: `emwaveracr<unique>`
- SKU: **Basic** is fine for dev

Then in the registry:
- Settings → **Access keys** → **Enable** (for initial/simple CI)
  - copy: Login server, Username, Password

> Later we can switch to managed identity + ACR pull role (more secure), but access keys get you moving.

### C) Create Container Apps Environment

Azure Portal → Container Apps → Create
- Create **Environment** (or create a backend app and it will prompt)
- Use same region as your RG

### D) Create Backend Container App

Azure Portal → Container Apps → Create
- App name: `emwaver-backend`
- Environment: (the env you created)
- Image source: ACR (you can set a placeholder image first)
- Ingress: **External**
- Target port: **8787**

After creation, set environment variables (Container App → Configuration → Environment variables):
- `EMWAVER_AUTH_MODE`
- `EMWAVER_ALLOW_ANON_SYNC`
- `DATABASE_URL`
- `AZURE_STORAGE_CONNECTION_STRING`
- `AZURE_STORAGE_CONTAINER`
- Firebase vars if auth enabled:
  - `FIREBASE_PROJECT_ID`
  - `FIREBASE_SERVICE_ACCOUNT_JSON`

### E) Create Frontend Container App

Azure Portal → Container Apps → Create
- App name: `emwaver-frontend`
- Ingress: **External**
- Target port: **3000**

(Frontend config is compiled at build time; runtime env vars are not enough unless we change the app.)

---

## 2) GitHub → Azure: OIDC credentials

We deploy via `azure/login@v2` using **OIDC** (no long-lived Azure secrets).

### A) Create an Azure AD App Registration

Azure Portal → Microsoft Entra ID → App registrations → New registration
- Name: `emwaver-github-deployer`

Record:
- Application (client) ID → `AZURE_CLIENT_ID`
- Directory (tenant) ID → `AZURE_TENANT_ID`

### B) Create Federated Credential for GitHub

App registration → Certificates & secrets → Federated credentials → Add
- Scenario: GitHub Actions
- Repository: `<owner>/<repo>`
- Entity: Branch
- Branch name: `main`
- Name: `github-main`

### C) Grant the app permissions

Go to your subscription or resource group:
- IAM (Access control) → Add role assignment
- Role: **Contributor** (scoped to the resource group is fine)
- Assign access to: User, group, or service principal
- Pick: `emwaver-github-deployer`

---

## 3) GitHub Secrets

Repo → Settings → Secrets and variables → Actions → New repository secret

### Required Azure secrets
- `AZURE_CLIENT_ID`
- `AZURE_TENANT_ID`
- `AZURE_SUBSCRIPTION_ID`
- `AZURE_RESOURCE_GROUP`

### ACR (initial/simple mode)
- `AZURE_ACR_LOGIN_SERVER` (e.g. `emwaveracrxyz.azurecr.io`)
- `AZURE_ACR_USERNAME`
- `AZURE_ACR_PASSWORD`

### App names / image names
- `AZURE_BACKEND_APP_NAME` (e.g. `emwaver-backend`)
- `AZURE_FRONTEND_APP_NAME` (e.g. `emwaver-frontend`)
- `AZURE_BACKEND_IMAGE_NAME` (e.g. `emwaver-backend`)
- `AZURE_FRONTEND_IMAGE_NAME` (e.g. `emwaver-frontend`)

### Backend runtime config (examples)
- `EMWAVER_AUTH_MODE` (e.g. `disabled` for staging)
- `EMWAVER_ALLOW_ANON_SYNC` (e.g. `1` for staging)
- `DATABASE_URL`
- `AZURE_STORAGE_CONNECTION_STRING`
- `AZURE_STORAGE_CONTAINER`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_SERVICE_ACCOUNT_JSON`

### Frontend build-time config
- `NEXT_PUBLIC_EMWAVER_BACKEND_URL` (your backend public URL)
- `NEXT_PUBLIC_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
- `NEXT_PUBLIC_FIREBASE_APP_ID`

---

## 4) Workflows

- Backend deploy: `.github/workflows/deploy-azure-backend.yml`
- Frontend deploy: `.github/workflows/deploy-azure-frontend.yml`

They run on:
- `push` to `main` (when relevant paths change)
- manual `workflow_dispatch`

---

## Notes / Next hardening steps

- Use ACR **managed identity** instead of access keys.
- Add a staging environment (`emwaver-staging-rg` or `emwaver-backend-staging` / `emwaver-frontend-staging`) and deploy from a `staging` branch.
- Consider `output: "standalone"` in Next config to reduce image size and avoid copying full `node_modules`.
