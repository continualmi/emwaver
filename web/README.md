# EMWaver Public Web Surface (`/web`)

Target direction: `web/` should trend toward static public pages, docs, downloads, board/build references, and product information.

This folder still contains legacy/transitional Next.js + Node auth, subscription, cloud dashboard, API, Agent, and WebSocket relay code. Those parts should be treated as migration debt for the local-first rebirth unless a task explicitly targets optional hosted services or paid Agent/API usage.

The full `.emw` script rendering/control experience belongs in `gateway/`, not in `web/`.

The deployment target should also simplify: move away from a long-running `emwaver-web` backend/container and toward a Society-style static export served from blob/static website hosting. If a page can be static, keep it static. Dynamic Agent/API or optional hosted-service behavior should move to a focused backend endpoint rather than keeping the public web surface as a catch-all runtime.

Do not add new cloud script storage, script sync, or account-backed script libraries here for the open-source core path. Script files should be local-device data by default.

---

## 1) Scope

`/web` target ownership:
- public landing/site pages,
- public video/media pages,
- install/download/build information,
- static docs and product pages,
- board manager/catalog pages backed by static manifests and canonical hardware assets.

Transitional/migration-debt areas still present here:
- account/auth/subscription UX surfaces,
- cloud dashboard and file/session flows,
- cloud script storage/sync assumptions,
- web integrations for backend APIs,
- remote host/web-session client pieces,
- shared UI renderer components that should move or be shared with `gateway/`.

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

Local development expects the sibling workspace layout:
- `/Users/luisml/continualmi/emwaver`
- `/Users/luisml/continualmi/continual-core`

The web app consumes `continual-core` through `file:../../continual-core`, so shared contract changes apply locally after reinstall/rebuild without publishing a package first.

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

Homepage content currently carries product narrative blocks:
- host-backed and autonomous device model,
- AI-first agent workflows,
- script-centric workflow,
- platform coverage,
- remote/cloud control narrative,
- CTA routes (`/build`, `/install`, `/scripts`).

Society no longer acts as an EMWaver entry surface. `continualmi.com` is now a static company/research/MDL site, while EMWaver public web/media/docs live here and community activity happens on Discord.

## 4.2 Components

Important shared components include:
- `SiteHeader` and `AccountPill` (global framing and account access)
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
- `clientSession.ts` — browser session bootstrap, sign-in route helpers, and sign-out helpers.
- `store.ts` — subscription/checkout helpers.

---

## 5) Backend integration contract

The app serves the same-origin backend routes under `/v1/*` and related service endpoints.

Current server routes in this folder include:
- `POST /api/auth/session`
- `POST /api/auth/signout`
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
- `GET /v1/auth/key`
- `GET /api/auth/key`
- `POST /api/auth/key`
- `DELETE /api/auth/key`
- `POST /provisioning/mint`
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
- account/subscription truth resolves through Postgres-backed `core` state on the shared Continual Postgres runtime,
- interactive sign-in is owned by EMWaver: `/signin` renders the branded auth shell and `/signin/complete` finishes same-tab Google redirect sign-in before `/api/auth/session` issues an EMWaver-signed product session,
- browser flows continue to use the EMWaver session cookie, while native apps can now use a web-managed EMWaver API key as their bearer credential,
- agent model completions are routed by the EMWaver web server itself through its configured OpenAI-compatible backend,
- device provisioning is keyed by `board_type + hardware_uid`, and live provisioning state now resolves through Postgres-backed `emwaver.provisioned_devices`,
- store orders now resolve through Postgres-backed `core.store_orders`,
- legacy JSON data remains only as migration input for a few fallback imports, not as the intended steady-state source of truth,
- host presence and WebSocket routing are currently single-instance in-memory,
- deferred local-disk state still includes agent history, Society/forum data, and user files,
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

## 6) Product pages and subscription/account direction

This frontend is where build/account hardware-related web flows live.

Direction reflected in repo docs:
- `/build` is the primary board catalog + self-build page,
- device detail pages on `/build/[slug]` should expose build-resource actions (for example BOM, CPL, Gerbers, schematics, PCB docs) as GitHub-backed links, using direct file downloads when an exact repo file path is known and otherwise linking out to the relevant hardware repo/folder,
- `/cloud` is the signed-in dashboard for files, hosts, and activated-device visibility,
- `/signin` is the only intended browser sign-in entrypoint and uses same-tab Google redirect instead of popup windows,
- account/session/Pro management now lives in the header account-pill modal, and `/account` is a dedicated account page built around the same account panel,
- `/order` and `/hardware` redirect into `/build` for legacy links,
- device/account flows are web-managed,
- pricing and subscription UX should center on service plans rather than per-device purchases,
- shared account, subscription, entitlement, and wallet truth should live in the shared production Postgres database under `core`, with EMWaver-local product tables in `emwaver`,
- the production runtime now uses `continualpg03231028/continual` without changing the app-side `DATABASE_URL` contract,
- no direct end-user installer distribution pages as primary channel (store-first model).

Store distribution policy migrated from AGENTS:
- Apple App Store (iOS/macOS), Google Play Store (Android), Microsoft Store (Windows).
- Do not position direct `.dmg` / `.apk` / `.exe` distribution as default end-user channel.

---

## 7) Assets and branding notes

- Board/module photos, renders, diagrams, and reusable hardware media should live once under the relevant `hardware/<repo-name>/` folder when they describe that hardware.
- `web/` should reference canonical hardware assets or static exported copies generated from them instead of keeping duplicate board images under `public/`.
- Current image assets are under `public/`, but board catalog manifests may also point image entries at repo-backed `github:` paths so imported hardware folders can own their own photo/render sets.
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

Current deployment is migration debt:
- single Azure Container App deployment,
- GitHub Actions image build/deploy on pushes to the `prod` branch,
- production image publishing as `ghcr.io/continualmi/emwaver-web`,
- legacy same-origin API/WebSocket assumptions.

Target deployment:
- static export for public EMWaver pages,
- blob/static website container as the origin, similar to `~/continualmi/society`,
- optional CDN/front-door layer for HTTPS, caching, and custom domains,
- no long-running public web container for landing/docs/download/build pages.

Dynamic code should move to the right owner before the static export becomes canonical:
- localhost hardware control and script rendering: `gateway/`,
- paid Agent: focused Continual MI Agent/API backend,
- optional hosted services: separate hosted-service runtime if kept at all.

Migration inventory: `STATIC_MIGRATION_INVENTORY.md`.

---

## 10) Documentation maintenance rule

When you change any of these, update this README in same PR:
1. page routes / information architecture,
2. backend integration endpoints used by frontend,
3. remote session protocol expectations,
4. order/account/store flow behavior.
