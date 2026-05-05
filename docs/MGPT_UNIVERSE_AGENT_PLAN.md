# MGPT Universe Agent Plan

EMWaver Agent apps should behave as thin clients for persistent MGPT universes. MGPT is a general-purpose stateful Responses API with `universe` as the state container name. It has no notion of EMWaver, MDL, boards, scripts, flashing, or product-specific schemas at this boundary.

## Goal

EMWaver clients send a generic universe turn to the MGPT-facing boundary:

```json
{
  "universe": "persistent-universe-id",
  "userInput": "Debug this flashing error."
}
```

MGPT loads the universe from server-side cache/storage, composes private prompts and model state, runs the turn, and returns only assistant-visible conversation output. MGPT has no EMWaver-specific hardware, script, board, flashing, or runtime-error schema at this boundary.

## App Responsibilities

- Store or receive a persistent `universe` id for each workspace/project when using paid Agent API features.
- Send `userInput` as the canonical new user message.
- Keep `prompt` only as a temporary compatibility alias for older Agent endpoints.
- Convert any local app context into user-visible conversation text before the MGPT boundary.
- Render only assistant-visible output.
- Keep local hardware control account-free when no Agent API key or universe is configured.

## App Non-Responsibilities

- Do not store production system prompts.
- Do not request or display backend-composed prompts.
- Do not read or write MGPT universe database rows.
- Do not serialize full universe documents from the client.
- Do not send EMWaver-specific hardware/script/runtime schemas to MGPT.
- Do not gate local `.emw` execution behind Agent auth.

## Current Implementation Prep

- Gateway `/v1/agent` forwards `userInput` and injects `EMWAVER_AGENT_UNIVERSE` or `CONTINUAL_AGENT_UNIVERSE` when configured.
- CLI `emwaver agent` sends `userInput` and the configured universe id.
- Windows Agent API sends `userInput` and the configured universe id.
- Android Agent API sends `userInput` and the configured universe id.

## MGPT Compatibility

MDL/MGPT already uses Redis universe cache keys shaped as `mgpt:universe:v1:<universeId>`. EMWaver should follow that server-side pattern rather than introducing an EMWaver-owned conversation database. Any EMWaver-specific tool or hardware handling belongs outside MGPT's generic universe-turn contract.

## Next Implementation Steps

- Add a first-class universe creation/linking endpoint once MGPT exposes the Agent API surface.
- Replace UI labels that say "conversation" where they represent persistent MGPT universe identity.
- Add a local adapter that can summarize user-approved app context into `userInput` without adding EMWaver-specific schema to MGPT.
- Add idempotency keys for retry-safe Agent turns.
