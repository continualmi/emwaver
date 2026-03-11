# EMWaver Website / Web App (`/frontend`)

Next.js frontend for EMWaver’s public web surface and web-based cloud flows.

This folder is the single public-facing documentation/marketing/web-dashboard surface in the repo.

---

## 1) Scope

`/frontend` currently contains:
- public landing/site pages,
- install/order/account/store UX surfaces,
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
- `public/`
  - static assets used by the site
- `legacy-static/`
  - legacy static site artifacts retained for reference/migration
- `Dockerfile`
  - container build for deployment

---

## 4) Key frontend modules

## 4.1 App shell and homepage

- `src/app/layout.tsx` defines global layout shell.
- `src/app/page.tsx` is the main marketing/positioning landing page.

Homepage content currently carries product narrative blocks:
- host-backed and autonomous device model,
- AI-first agent workflows,
- script-centric workflow,
- platform coverage,
- remote/cloud control narrative,
- CTA routes (`/order`, `/install`, `/scripts`).

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

Frontend expects backend routes under `/v1/*` and related service endpoints.

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

This frontend is where order/account hardware-related web flows live.

Direction reflected in repo docs:
- `/order` is the device availability / purchase-intent page and can route users into the hardware self-build flow while direct sales are not open,
- `/account` handles attached-device/account relationship UX,
- `/hardware` hosts the restored STM32 hardware catalog and the self-build / JLCPCB-oriented EMWaver builder flow,
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
cd frontend
npm install
npm run dev
```

Open: `http://localhost:3200`

If testing backend-dependent flows, ensure backend is running and configured in frontend env/config helpers.

---

## 9) Deployment

- Built/deployed as container app (Azure Container Apps).
- CI/CD references exist in repo workflows (frontend deploy pipeline).

Keep deployment assumptions aligned with:
- backend base URL resolution,
- websocket URL derivation,
- CORS and auth token flow.

---

## 10) Documentation maintenance rule

When you change any of these, update this README in same PR:
1. page routes / information architecture,
2. backend integration endpoints used by frontend,
3. remote session protocol expectations,
4. order/account/store flow behavior.
