---
name: emwaver-web
description: Use when working on the EMWaver web app in /web, including the public site, static export migration, docs/downloads/board pages, agent-route migration, legacy WebSocket relay, JSON-backed stores, or local-first web/gateway boundary.
---

# EMWaver Web

Use this skill for work under [`/Users/luisml/continualmi/emwaver/web`](/Users/luisml/continualmi/emwaver/web).

## Read first

1. [`/Users/luisml/continualmi/emwaver/web/README.md`](/Users/luisml/continualmi/emwaver/web/README.md)
2. [`/Users/luisml/continualmi/emwaver/AGENTS.md`](/Users/luisml/continualmi/emwaver/AGENTS.md)
3. [`/Users/luisml/continualmi/PLANNING.md`](/Users/luisml/continualmi/PLANNING.md) if the task touches static export, auth/cloud removal, Agent API boundaries, or shared platform migration

## Scope

- This folder owns the public EMWaver web surface and should trend toward static pages/docs/downloads/board references.
- Existing account, billing, cloud dashboard, backend API, WebSocket relay, file sync, host session, and device provisioning code is migration debt unless isolated for the optional Agent API transition.
- Local hardware control and heavy `.emw` script rendering/control should move to `gateway/`, not remain a hosted web responsibility.
- Current deployment shape is still a single Next.js + Node service with a custom `server.ts` entrypoint, but the target is Society-style static hosting for public pages.

## Where things live

- [`/Users/luisml/continualmi/emwaver/web/src/app`](/Users/luisml/continualmi/emwaver/web/src/app): Next.js App Router pages and route handlers
- [`/Users/luisml/continualmi/emwaver/web/src/components`](/Users/luisml/continualmi/emwaver/web/src/components): site UI and EMW UI renderers
- [`/Users/luisml/continualmi/emwaver/web/src/lib`](/Users/luisml/continualmi/emwaver/web/src/lib): frontend helpers, API wrappers, sessions, catalog, remote attach helpers
- [`/Users/luisml/continualmi/emwaver/web/src/server`](/Users/luisml/continualmi/emwaver/web/src/server): legacy auth/cloud/platform code plus transitional Agent integration
- [`/Users/luisml/continualmi/emwaver/web/src/server/store`](/Users/luisml/continualmi/emwaver/web/src/server/store): legacy JSON/local-disk backed state for entitlements, files, orders, host sessions, devices, and agent conversations
- [`/Users/luisml/continualmi/emwaver/web/server.ts`](/Users/luisml/continualmi/emwaver/web/server.ts): unified Next.js + Node runtime entrypoint

## High-value modules

- [`/Users/luisml/continualmi/emwaver/web/src/server/auth.ts`](/Users/luisml/continualmi/emwaver/web/src/server/auth.ts): legacy product session auth handling
- [`/Users/luisml/continualmi/emwaver/web/src/server/continualHandoff.ts`](/Users/luisml/continualmi/emwaver/web/src/server/continualHandoff.ts): shared-platform handoff verification
- [`/Users/luisml/continualmi/emwaver/web/src/server/platformCore.ts`](/Users/luisml/continualmi/emwaver/web/src/server/platformCore.ts): EMWaver integration layer for the shared `continual-core` contract
- [`/Users/luisml/continualmi/emwaver/web/src/server/agentTools.ts`](/Users/luisml/continualmi/emwaver/web/src/server/agentTools.ts) and [`/Users/luisml/continualmi/emwaver/web/src/server/openaiCompat.ts`](/Users/luisml/continualmi/emwaver/web/src/server/openaiCompat.ts): backend-managed agent routing
- [`/Users/luisml/continualmi/emwaver/web/src/server/ws`](/Users/luisml/continualmi/emwaver/web/src/server/ws): WebSocket routing and in-memory state
- [`/Users/luisml/continualmi/emwaver/web/src/lib/backend.ts`](/Users/luisml/continualmi/emwaver/web/src/lib/backend.ts): typed browser client to server routes
- [`/Users/luisml/continualmi/emwaver/web/src/lib/remoteSessions.ts`](/Users/luisml/continualmi/emwaver/web/src/lib/remoteSessions.ts) and [`/Users/luisml/continualmi/emwaver/web/src/lib/remoteAttach.ts`](/Users/luisml/continualmi/emwaver/web/src/lib/remoteAttach.ts): remote host attach semantics

## Important constraints

- EMWaver should not own a product account system for core local use. Existing sign-in/session/account code is migration debt.
- Any future paid account/subscription semantics should belong to the focused Continual MI/MGPT Agent API backend, not to a general EMWaver cloud runtime.
- Agent inference should move toward a focused Continual MI/MGPT API-key backend. Do not ship production prompts, hidden `.emw` instruction packs, provider-routing logic, or metering policy in this repo.
- Current persistence is transitional: local filesystem and JSON-backed state under `.data`. Treat that as temporary and avoid deepening it.
- Host presence, WS routing, file sync, device provisioning, Stripe, and account UX are not part of the desired local-first public web target.
- Local hardware access must not be gated by account state, subscription policy, hardware UID, device activation, minting, claiming, or device limits.

## Routing cues

- Marketing, docs, install, downloads, and board/build pages live in `src/app`.
- Device/account helpers, auth, entitlements, credits, files, provisioning, Stripe, and hosted relay logic are migration-debt surfaces under `src/lib`, `src/server`, and `src/server/store`.
- Local browser hardware control belongs in `gateway/`.

## Common task routing

- Marketing, docs, or public information architecture: [`/Users/luisml/continualmi/emwaver/web/src/app`](/Users/luisml/continualmi/emwaver/web/src/app)
- Legacy product session or account migration: [`/Users/luisml/continualmi/emwaver/web/src/server/auth.ts`](/Users/luisml/continualmi/emwaver/web/src/server/auth.ts), [`/Users/luisml/continualmi/emwaver/web/src/server/platformCore.ts`](/Users/luisml/continualmi/emwaver/web/src/server/platformCore.ts)
- Agent conversation or tool-call behavior: [`/Users/luisml/continualmi/emwaver/web/src/app/v1/agent`](/Users/luisml/continualmi/emwaver/web/src/app/v1/agent), [`/Users/luisml/continualmi/emwaver/web/src/server/agentTools.ts`](/Users/luisml/continualmi/emwaver/web/src/server/agentTools.ts)
- Legacy device, entitlement, provisioning, store, Stripe, host presence, and web control surfaces: inspect before removing, but do not expand them for core local hardware control.

## Validation posture

- Use `npm run lint` or targeted route checks when useful.
- Be careful with stateful local `.data` assumptions while testing.
