---
name: emwaver-web
description: Use when working on the EMWaver web app in /web, including the public site, account and subscription flows, same-origin /v1 APIs, agent routes, WebSocket relay, JSON-backed server stores, or shared `continual-core` integration.
---

# EMWaver Web

Use this skill for work under [`/Users/luisml/continualmi/emwaver/web`](/Users/luisml/continualmi/emwaver/web).

## Read first

1. [`/Users/luisml/continualmi/emwaver/web/README.md`](/Users/luisml/continualmi/emwaver/web/README.md)
2. [`/Users/luisml/continualmi/emwaver/AGENTS.md`](/Users/luisml/continualmi/emwaver/AGENTS.md)
3. [`/Users/luisml/continualmi/PLANNING.md`](/Users/luisml/continualmi/PLANNING.md) if the task touches auth, billing, tokens, or shared platform migration

## Scope

- This folder owns the public EMWaver web surface plus the Node-backed API and WS relay.
- It is the canonical home for landing pages, build/install/account flows, `/v1/*` service routes, agent endpoints, and Stripe/account work.
- Hardware operations are orchestrated through apps, daemon hosts, autonomous devices, and backend APIs, not directly from the browser.
- Current deployment shape is single Next.js + Node service with a custom `server.ts` entrypoint for WebSocket handling.

## Where things live

- [`/Users/luisml/continualmi/emwaver/web/src/app`](/Users/luisml/continualmi/emwaver/web/src/app): Next.js App Router pages and route handlers
- [`/Users/luisml/continualmi/emwaver/web/src/components`](/Users/luisml/continualmi/emwaver/web/src/components): site UI and EMW UI renderers
- [`/Users/luisml/continualmi/emwaver/web/src/lib`](/Users/luisml/continualmi/emwaver/web/src/lib): frontend helpers, API wrappers, sessions, catalog, remote attach helpers
- [`/Users/luisml/continualmi/emwaver/web/src/server`](/Users/luisml/continualmi/emwaver/web/src/server): auth, platform client, server env, agent integration, Stripe, WS state
- [`/Users/luisml/continualmi/emwaver/web/src/server/store`](/Users/luisml/continualmi/emwaver/web/src/server/store): JSON/local-disk backed state for entitlements, files, orders, host sessions, devices, agent conversations
- [`/Users/luisml/continualmi/emwaver/web/server.ts`](/Users/luisml/continualmi/emwaver/web/server.ts): unified Next.js + Node runtime entrypoint

## High-value modules

- [`/Users/luisml/continualmi/emwaver/web/src/server/auth.ts`](/Users/luisml/continualmi/emwaver/web/src/server/auth.ts): product session auth handling
- [`/Users/luisml/continualmi/emwaver/web/src/server/continualHandoff.ts`](/Users/luisml/continualmi/emwaver/web/src/server/continualHandoff.ts): shared-platform handoff verification
- [`/Users/luisml/continualmi/emwaver/web/src/server/platformCore.ts`](/Users/luisml/continualmi/emwaver/web/src/server/platformCore.ts): EMWaver integration layer for the shared `continual-core` contract
- [`/Users/luisml/continualmi/emwaver/web/src/server/agentTools.ts`](/Users/luisml/continualmi/emwaver/web/src/server/agentTools.ts) and [`/Users/luisml/continualmi/emwaver/web/src/server/openaiCompat.ts`](/Users/luisml/continualmi/emwaver/web/src/server/openaiCompat.ts): backend-managed agent routing
- [`/Users/luisml/continualmi/emwaver/web/src/server/ws`](/Users/luisml/continualmi/emwaver/web/src/server/ws): WebSocket routing and in-memory state
- [`/Users/luisml/continualmi/emwaver/web/src/lib/backend.ts`](/Users/luisml/continualmi/emwaver/web/src/lib/backend.ts): typed browser client to server routes
- [`/Users/luisml/continualmi/emwaver/web/src/lib/remoteSessions.ts`](/Users/luisml/continualmi/emwaver/web/src/lib/remoteSessions.ts) and [`/Users/luisml/continualmi/emwaver/web/src/lib/remoteAttach.ts`](/Users/luisml/continualmi/emwaver/web/src/lib/remoteAttach.ts): remote host attach semantics

## Important constraints

- EMWaver owns its own product sign-in UX and product sessions.
- Shared account, wallet, entitlement, and subscription semantics should come from the shared `continual-core` contract and shared `core` schema rather than a central Society runtime API.
- Agent model completions are product-managed inside EMWaver. Do not add client-side provider secrets or direct user-managed provider auth.
- Current persistence is intentionally transitional: local filesystem and JSON-backed state under `.data`. Treat that as temporary and avoid deepening it unnecessarily.
- Host presence and WS routing are currently single-instance and in-memory.
- Pricing and subscription UX should center on service plans, not per-device purchases.
- Device provisioning, restore, and limits are keyed only by `board_type + hardware_uid`.

## Routing cues

- Marketing and install/account/build UX live in `src/app`.
- Device/account helpers and session bootstrap live in `src/lib`.
- Auth, entitlements, credits, agent, files, provisioning, and Stripe logic live in `src/server` plus `src/server/store`.
- Remote host web control uses `src/lib/remoteSessions.ts`, `src/lib/remoteAttach.ts`, and `src/server/ws`.

## Common task routing

- Marketing, docs, or public information architecture: [`/Users/luisml/continualmi/emwaver/web/src/app`](/Users/luisml/continualmi/emwaver/web/src/app)
- Product session auth or shared-core account integration: [`/Users/luisml/continualmi/emwaver/web/src/server/auth.ts`](/Users/luisml/continualmi/emwaver/web/src/server/auth.ts), [`/Users/luisml/continualmi/emwaver/web/src/server/platformCore.ts`](/Users/luisml/continualmi/emwaver/web/src/server/platformCore.ts)
- Agent conversation or tool-call behavior: [`/Users/luisml/continualmi/emwaver/web/src/app/v1/agent`](/Users/luisml/continualmi/emwaver/web/src/app/v1/agent), [`/Users/luisml/continualmi/emwaver/web/src/server/agentTools.ts`](/Users/luisml/continualmi/emwaver/web/src/server/agentTools.ts)
- Device, entitlement, or provisioning behavior: [`/Users/luisml/continualmi/emwaver/web/src/app/v1/devices`](/Users/luisml/continualmi/emwaver/web/src/app/v1/devices), [`/Users/luisml/continualmi/emwaver/web/src/server/store/provisionedDevices.ts`](/Users/luisml/continualmi/emwaver/web/src/server/store/provisionedDevices.ts)
- Store or Stripe work: [`/Users/luisml/continualmi/emwaver/web/src/app/v1/store`](/Users/luisml/continualmi/emwaver/web/src/app/v1/store), [`/Users/luisml/continualmi/emwaver/web/src/app/v1/pro`](/Users/luisml/continualmi/emwaver/web/src/app/v1/pro), [`/Users/luisml/continualmi/emwaver/web/src/server/stripe.ts`](/Users/luisml/continualmi/emwaver/web/src/server/stripe.ts)
- Host presence and web control: [`/Users/luisml/continualmi/emwaver/web/src/app/v1/hosts`](/Users/luisml/continualmi/emwaver/web/src/app/v1/hosts), [`/Users/luisml/continualmi/emwaver/web/src/server/ws`](/Users/luisml/continualmi/emwaver/web/src/server/ws)

## Validation posture

- Use `npm run lint` or targeted route checks when useful.
- Be careful with stateful local `.data` assumptions while testing.
