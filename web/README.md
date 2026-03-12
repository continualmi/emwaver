# EMWaver Unified Web App (`/web`)

Next.js + Node unified web app for EMWaver’s public web surface and web-based cloud flows.

This folder is the canonical EMWaver web surface in the repo. It now owns the public website, web APIs, agent endpoints, store/account flows, and the WebSocket relay under one Next.js + Node deployment.

---

## 1) Scope

`/web` currently contains:
- public landing/site pages,
- install/build/account/store UX surfaces,
- hardware catalog + builder web surfaces,
- web integrations for backend APIs,
- remote host/web-session client pieces,
- shared UI runtime renderers for remote script UI previews.

It does **not** host firmware/device logic directly; hardware operations happen through host apps, autonomous devices, and backend APIs.

---

## 2) Stack

- Next.js `16.x` (App Router)
- React `19.x`
- TypeScript
- TailwindCSS 4 + custom CSS
- Custom Node server entrypoint for WebSocket handling and unified deployment

Key scripts (`package.json`):
- `npm run dev`
- `npm run build`
- `npm run start`
- `npm run lint`

---

## 3) Folder map

- `src/app/`
  - app router entrypoints (`layout.tsx`, `page.tsx`, global styles, icons)
- `src/components/`
  - shared visual components and EMW UI renderer components
- `src/lib/`
  - client-side API helpers, remote session/websocket helpers, config utilities
- `src/server/`
  - Node-side config/auth/WebSocket/backend modules
- `server.ts`
  - unified Next.js + Node runtime entrypoint
- `public/`
  - static assets used by the site
- `legacy-static/`
  - legacy static site artifacts retained for reference/migration
- `Dockerfile`
  - container build for unified deployment

---

## 4) Key frontend modules

## 4.1 App shell and homepage

- `src/app/layout.tsx` defines global layout shell.
- `src/app/page.tsx` is the main marketing/positioning landing page.
- The app shell includes a fixed under-construction banner at first load so the public deployment communicates incomplete surface areas clearly.

Homepage content currently carries product narrative blocks:
- host-backed and autonomous device model,
- AI-first agent workflows,
- script-centric workflow,
- platform coverage,
- remote/cloud control narrative,
- CTA routes (`/build`, `/install`, `/scripts`).

Society routes no longer render first-party in this frontend; `/society/*` now redirects to the dedicated Society frontend.
Configure `SOCIETY_SITE_URL` or `NEXT_PUBLIC_SOCIETY_SITE_URL` if the redirect target is not the default `https://continualmi.com`.

## 4.2 Components

Important shared components include:
- `SiteHeader`, `SiteFooter` (global framing)
- `InformativeShell` (content shell)
- `EmwUiRenderer`, `EmwUiPreview`, `RemoteEmwUi` (rendering EMW UI trees/snapshots for web experiences)

## 4.3 Frontend API client layer (`src/lib`)

- `backendConfig.ts` — backend base URL resolution.
- `backend.ts` — typed wrappers for:
  - files APIs,
  - agent conversation/messages/chat APIs,
  - SSE streaming chat,
  - host list APIs.
- `remoteSessions.ts` / `remoteAttach.ts` — WS message types + connection helpers for host/web control sessions.
- `firebase.ts` — auth integration support.
- `store.ts` — store/order helpers.

---

## 5) Backend integration contract

The app serves the same-origin backend routes under `/v1/*` and related service endpoints.

Current server routes in this folder include:
- `GET /health`
- `GET /health/config`
- `GET /openapi.json`
- `GET /docs-api`
- `GET /v1/health/config`
- `GET /v1/entitlements`
- `GET /v1/credits`
- `GET /v1/hosts`
- `POST /v1/hosts/heartbeat`
- `GET /v1/files`
- `GET /v1/files/content?name=...`
- `POST /v1/files/upload`
- `DELETE /v1/files?name=...`
- `POST /v1/devices/attach`
- `POST /v1/devices/seen`
- `GET /v1/devices/my`
- `POST /v1/devices/label`
- `POST /provisioning/mint`
- `POST /v1/auth/handoff/start`
- `POST /v1/auth/handoff/consume`
- `GET /v1/agent/conversations`
- `POST /v1/agent/conversations`
- `PATCH /v1/agent/conversations/:conversationId`
- `DELETE /v1/agent/conversations/:conversationId`
- `GET /v1/agent/conversations/:conversationId/messages`
- `POST /v1/agent/conversations/:conversationId/messages`
- `POST /v1/agent/chat`
- `POST /v1/agent/chat/stream`
- `POST /v1/agent/chat/stream_tools`
- `POST /v1/store/checkout_session`
- `GET /v1/store/orders/my`
- `POST /v1/store/orders/claim`
- `POST /v1/store/stripe/webhook`
- `POST /v1/pro/checkout_session`
- `POST /v1/pro/portal`
- `POST /v1/pro/stripe/webhook`
- `POST /v1/admin/grant_pro`
- `GET /v1/society/posts`
- `GET /v1/society/posts/:postId`
- `GET /v1/society/posts/:postId/comments`
- `POST /v1/society/posts/:postId/comments`
- `POST /v1/society/forum/threads`
- `GET /v1/ws?token=...` (custom server upgrade path)

Current implementation notes:
- file storage is temporarily local filesystem-backed under `web/.data/user-files/` rather than Postgres,
- account/store/agent/society data is currently JSON/local-disk backed under `web/.data/server/`,
- device provisioning currently supports a hardware-UID-backed claim/restore path keyed by `board_type + hardware_uid`, while preserving issued `DeviceID + Proof` for later authenticity checks,
- entitlements are currently local JSON-backed with optional `EMWAVER_DEFAULT_PRO=1` development override,
- host presence and WebSocket routing are currently single-instance in-memory,
- the current shape is suitable for a single-instance deployment and should move to shared state if multi-instance scaling is needed later.

### 5.1 Files

Used by `backend.ts`:
- `GET /v1/files`
- `GET /v1/files/content`
- `POST /v1/files/upload`
- `DELETE /v1/files`

### 5.2 Agent

Used by `backend.ts`:
- conversation listing/creation
- message listing
- chat request
- stream chat (`text/event-stream`)

### 5.3 Hosts and remote sessions

- `GET /v1/hosts` for host discovery/presence
- WebSocket `GET /v1/ws?token=...` for web<->host session traffic

Current remote-web implementation targets host sessions. Future autonomous device sessions will need their own presence/attach UX and client helpers.

WS URL conversion logic:
- backend `https` => `wss`
- backend `http` => `ws`

---

## 6) Product pages and store/account direction

This frontend is where build/account hardware-related web flows live.

Direction reflected in repo docs:
- `/build` is the primary board catalog + self-build page,
- `/account` handles attached-device/account relationship UX,
- `/order` and `/hardware` redirect into `/build` for legacy links,
- claim/recovery flows are web-managed,
- no direct end-user installer distribution pages as primary channel (store-first model).

Store distribution policy migrated from AGENTS:
- Apple App Store (iOS/macOS), Google Play Store (Android), Microsoft Store (Windows).
- Do not position direct `.dmg` / `.apk` / `.exe` distribution as default end-user channel.

---

## 7) Assets and branding notes

- Current image assets are under `public/`.
- `legacy-static/` contains historical web artifacts and should be treated as migration/reference content.
- If replacing hero/product visuals, keep optimized sizes and preserve route-stable filenames only when needed by existing links.

---

## 8) Local development

From repo root:

```bash
cd web
npm install
npm run dev
```

Open: `http://localhost:3200`

This single app is the backend for the web surface, so backend-dependent flows run from the same process. The custom `server.ts` entrypoint is required for `/v1/ws`.

---

## 9) Deployment

- Deployed as a single Azure App Service Node container.
- GitHub Actions builds and deploys this folder as the unified web/backend service.

Keep deployment assumptions aligned with:
- same-origin backend base URL resolution,
- websocket URL derivation,
- CORS and auth token flow.

---

## 10) Documentation maintenance rule

When you change any of these, update this README in same PR:
1. page routes / information architecture,
2. backend integration endpoints used by frontend,
3. remote session protocol expectations,
4. order/account/store flow behavior.
