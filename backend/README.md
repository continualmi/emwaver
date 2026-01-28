# EMWaver Cloud Backend (WIP)

This folder will host the cloud backend for EMWaver apps.

Initial scope (intended):

- Accounts + sessions (login, refresh)
- Script storage (projects, scripts, assets)
- Signal storage (syncable state/snapshots)
- Chat storage (agent conversations)
- LLM proxy endpoints (server-side key custody, policy, logging)

Non-goals (early):

- Shipping a required cloud dependency for core device exploration.
- Realtime collaboration.

Current status:

- Desktop-only agent chat is wired locally via Tauri backend + OpenRouter.
- Cloud backend implementation not started yet (this folder is the landing zone).

LLM model (current):

- `x-ai/grok-4.1-fast` via OpenRouter
