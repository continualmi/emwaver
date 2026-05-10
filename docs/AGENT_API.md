# EMWaver Agent API Direction

This document defines the first paid Agent service direction for the local-first EMWaver rebirth.

The open-source runtime, Gateway, CLI, firmware payloads, scripts, and local hardware control should work without an Agent key. The Agent is optional paid assistance for writing, debugging, explaining, and improving `.emw` scripts.

## Product Contract

The Agent helps with:

- writing `.emw` scripts from user intent,
- debugging runtime errors,
- turning module/datasheet behavior into script code,
- generating UI controls for scripts,
- adapting scripts between supported boards,
- explaining hardware responses and script behavior.

The Agent must not be required for local hardware access.

Each UI app should keep an Agent runtime/interface:

- browser Gateway Agent panel implemented in TypeScript,
- macOS/iOS Agent chat surfaces,
- Windows Agent chat surface,
- Android Agent chat surface.

Those app runtimes are clients. They collect local script/device/UI/error context, manage chat UX, and call the Agent endpoint. They must not embed production system prompts or private Agent instructions. Rust Gateway code should stay focused on local device/backend communication.

## Authentication

Use a simple Continual MI/MGPT Agent API key.

Initial client-side configuration targets:

```text
EMWAVER_AGENT_API_KEY
EMWAVER_AGENT_ENDPOINT
```

Future persisted local configuration can use an app-local EMWaver config file or platform keychain/credential store. This key is for Agent inference only; it is not an EMWaver account.

Missing key behavior:

- UI clients: show an Agent setup state while leaving local script control available.
- CLI: local hardware commands keep working without any Agent key. A future TypeScript Agent helper may add terminal Agent workflows outside the Rust device backend.

## MGPT Endpoint Shape

The Agent endpoint is MGPT's general-purpose stateful Responses API. EMWaver is only one client. MGPT has no notion of EMWaver, MDL, boards, scripts, flashing, or product-specific schemas at this boundary.

Endpoint concept:

```http
POST /backend-api/mgpt/responses
Authorization: Bearer <agent_api_key>
Content-Type: application/json
```

Request:

```json
{
  "universe": "persistent-universe-id",
  "userInput": "Write a script for an MFRC522 card read."
}
```

`userInput` is the canonical new user message. Any app-specific context must be abstracted before this boundary, usually by turning it into user-visible conversation text. Clients may omit `universe` only when the configured endpoint creates or resolves a default universe for the API key; otherwise they should persist one universe id per local workspace/project.

Response:

```json
{
  "message": "Explanation for the user.",
  "code": "optional generated text/code when the client asks for code",
  "patch": "optional patch-style edit when the client asks for one",
  "warnings": ["optional generic notes"],
  "usage": {
    "metered": true
  }
}
```

## Server-Side Responsibility

The Continual MI/MGPT backend should own:

- universe creation, ownership checks, cache reads, and cache-miss recovery,
- private system prompts,
- generic model/runtime policy,
- usage metering,
- provider/model routing.

The open-source client should send user intent and relevant context, not private system instructions.

For the hot path, MGPT should read the universe from Redis using the existing MDL/MGPT universe cache shape. EMWaver apps must not perform database reads, store prompt snapshots, serialize full universe documents, or send EMWaver-specific schemas to MGPT. Their MGPT-facing job is to send `universe` and `userInput`.

The open-source repo should keep only:

- Agent UI/runtime clients,
- endpoint/request/response contracts,
- harmless development fixtures,
- generic examples that can be public.

The open-source repo should not contain production Agent IP:

- private system prompts,
- proprietary `.emw` language instruction packs,
- hidden board/module recipes,
- provider selection logic,
- metering implementation.

Prompt secrecy is not the full moat. The real moat is the maintained Agent service: high-quality `.emw` expertise, hardware recipes, runtime-aware debugging, examples, and tight CLI/gateway integration.

## Client Integrations

Gateway browser UI:

- add an Agent panel,
- send only `universe` and `userInput` to the MGPT-facing endpoint,
- fold any user-approved local context into `userInput` before the boundary when needed,
- let users intentionally apply returned code or patch.

Terminal Agent tooling should be implemented in TypeScript or another client layer outside the Rust device backend.

## Non-Goals

- Do not put paid Agent checks on local hardware control.
- Do not ship private Agent prompts in the open-source client.
- Do not make hosted cloud sessions a prerequisite for Agent help.
- Do not frame the Agent as an EMWaver-specific model line.
