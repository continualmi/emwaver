# EMWaver Web Static Migration Inventory

This inventory supports `REBIRTH-023B`.

Goal: make `web/` a mostly static public surface deployed like `~/continualmi/society`, while removing cloud/runtime responsibility from the open-source core path.

Target public deployment:

```text
web static export
  -> blob/static website container
  -> optional CDN/front-door layer
```

Non-goals for the static public site:

- no hardware control runtime,
- no localhost gateway runtime,
- no hosted WebSocket relay,
- no cloud script storage,
- no required sign-in,
- no account-gated hardware access.

The gateway remains the local browser host-controller:

```text
browser / CLI
  -> localhost gateway
  -> native app connected as role=app or role=host
  -> app-owned .emw runtime and device transport
  -> board
```

## Route Classification

| Route or folder | Target | Notes |
| --- | --- | --- |
| `/` (`src/app/page.tsx`) | `static web` | Public landing page. Remove cloud-first product language as needed. |
| `/build` and `/build/[slug]` | `static web` | Board/build catalog should use static manifests and canonical `hardware/<repo-name>/` assets. |
| `/hardware` and `/hardware/[slug]` | `static web` | Board manager/catalog pages. Should not require account state. |
| `/docs/*` | `static web` | Static docs and install/script/hardware pages. |
| `/install` | `static web` | Static install/download guidance. |
| `/videos` | `static web` | Static media page. |
| `/news/*` | `static web` | Static news/content pages. |
| `/pinout` | `static web` | Static reference page unless it later becomes a local gateway tool. |
| `/scripts` | `static or gateway link` | Public examples can remain static; interactive script running belongs in `gateway/`. |
| `/society/*` | `static web` | Legacy/static bridge content. |
| `/order` and `/order/confirmed` | `hosted-service debt` | Store/order checkout flow. Keep only if store remains; otherwise replace with static build/buy guidance. |
| `/pro` | `Agent/backend` | Paid plan page can be static, but checkout/portal actions need a focused backend endpoint. |
| `/signin` and `/signin/complete` | `hosted-service debt` | Not needed for local hardware control. Static site can link to Agent account management later. |
| `/account` | `hosted-service debt` | Account panel is not part of static public core. |
| `/cloud` | `static web handoff` | Replaced with a static localhost gateway handoff page. The old cloud dashboard behavior is no longer in this core route. |
| `/cloud/hosts/*` | `remove from core` | Hosted remote host/session control. Not part of local-first launch. |
| `/cloud/agent` | `Agent/backend` | Agent UX should become API-key based and can be rebuilt in gateway/CLI against a focused Agent endpoint. |

## API And Backend Route Classification

| Route or module | Target | Notes |
| --- | --- | --- |
| `/health`, `/health/config`, `/v1/health/config` | `remove or external monitor` | Static site does not need same-origin runtime health endpoints. |
| `/openapi.json`, `/docs-api` | `hosted backend docs` | Keep only for whatever backend survives outside static `web/`. |
| `/api/auth/*`, `/v1/auth/*` | `hosted-service debt` | Not needed for local hardware control. Agent account/API-key management should move to focused backend. |
| `/v1/agent/*` | `Agent/backend` | Move to Continual MI Agent endpoint. Do not keep public site container alive for this. |
| `/v1/credits`, `/v1/entitlements` | `Agent/backend` | Useful only for paid Agent/account services. |
| `/v1/files/*` | `remove from core` | Cloud file/script storage is not part of the local-first core. |
| `/v1/hosts/*` | `remove from core` | Hosted host/session presence is not core. Gateway uses localhost app connections. |
| `/v1/devices/*`, `/provisioning/mint` | `hosted-service debt` | Device account/provisioning state is optional hosted-service behavior, not local runtime access. |
| `/v1/pro/*`, `/v1/store/*` | `hosted-service debt` | Checkout/webhook endpoints must live in a backend if kept. |
| `/v1/society/*` | `remove from EMWaver web` | Society/community backend should not live in EMWaver static site. |
| `/v1/ws` (`server.ts`, `src/server/ws/*`) | `gateway or optional hosted-service` | Local control WebSocket belongs in `gateway/`; hosted relay is optional future service debt. |

## Source Module Classification

| File or folder | Target | Notes |
| --- | --- | --- |
| `src/components/EmwUiRenderer.tsx` | `share with gateway` | Generic UI tree renderer. Keep protocol-neutral. |
| `src/components/RemoteEmwUi.tsx` | `share with gateway` | Rename later if no longer remote-specific. |
| `src/components/EmwUiPreview.tsx` | `share with gateway` | Useful for static examples and gateway preview. |
| `src/lib/emwUiRuntime.ts` | `gateway preview` | Browser preview only. Live hardware execution must stay app-owned through gateway. |
| `src/lib/exampleEmwScripts.ts` | `static/gateway shared` | Examples should be generated from repo scripts and usable without account state. |
| `src/lib/catalog.ts`, `src/lib/hardwareCatalog.ts` | `static web` | Should resolve static board data and canonical hardware assets. |
| `src/lib/backend.ts` | `remove from static web` | Same-origin cloud API client. Gateway local control should not depend on it. |
| `src/lib/backendConfig.ts` | `remove from static web` | Backend URL selection should not be needed by static pages except external Agent links. |
| `src/lib/clientSession.ts`, `src/lib/firebase.ts` | `hosted-service debt` | Auth/session client code. Not part of static public core. |
| `src/lib/remoteSessions.ts`, `src/lib/remoteAttach.ts` | `split` | Message types may be shared; hosted URL/auth/attach behavior should not be in gateway/static web. |
| `src/components/Account*`, `EmwAuthGoogleButton.tsx` | `hosted-service debt` | Account UI can move to a focused Agent/account app if needed. |
| `src/components/DashboardDevicesPanel.tsx` | `remove or replace` | Account-device panel is not local device status. Gateway needs local device status from app. |
| `src/server/**` | `move out of static web` | Agent, auth, Stripe, Postgres, files, WS, and stores are backend/service code. |
| `server.ts` | `retire for static web` | Required only for current Next+Node/WebSocket runtime. |
| `Dockerfile` | `retire for static web` | Container deploy is migration debt for the public site. |

## Static Export Blockers

- `npm run build:static` currently fails while compiling backend route handlers because `src/app/api/auth/session/route.ts` imports `src/server/platformCore.ts`, which imports `continual-core`. In this checkout layout the package cannot be resolved from `web/`; more importantly, static export should not compile the legacy auth/backend route set at all.
- Route handlers under `src/app/**/route.ts` require a runtime and must be removed from the public static route set or moved to a backend.
- `server.ts` owns `/v1/ws`; static export cannot support hosted WebSocket upgrades.
- Account pages import session/backend helpers that assume same-origin APIs.
- Store/Stripe and Agent endpoints are server-only and must be separated before static deploy is canonical.
- Some board/catalog images still live under `web/public`; reusable hardware media should be canonical under `hardware/<repo-name>/`.

## Progress

- `/cloud` now renders a static local-first gateway handoff and no longer imports auth, Pro entitlements, cloud files, hosted hosts, backend WebSocket helpers, or dashboard device panels.
- `npm run build:static` enables a conditional Next static export mode via `EMWAVER_STATIC_EXPORT=1`, matching the Society-style `output: "export"` direction while keeping the existing runtime build unchanged.

## Migration Order

1. Freeze `web/` as public content only for new work.
2. Move remaining script control/UI execution work into `gateway/`.
3. Convert `/cloud` routes into redirects or remove them from the static public route set.
4. Split Agent routes into a focused Agent/API backend and expose only static marketing/API-key setup links from `web/`.
5. Move checkout/account/device hosted-service routes out of public `web/` or explicitly defer them.
6. Add a static export build/deploy path modeled after `~/continualmi/society`.
7. Deduplicate board/module media into `hardware/<repo-name>/` and update catalog references.

## Done Criteria

- Static pages build without requiring `server.ts`.
- Public web deploy does not require Postgres, Firebase Admin, Stripe, `ws`, local `.data`, or `continual-core` server contracts.
- Hardware control works through `gateway/` and native apps without `web/`.
- Agent usage is optional and goes through a focused API-key backend.
- No public page needs cloud script storage or hosted host/session discovery.
