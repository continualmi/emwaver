# EMWaver Agent API Direction

This contributor document defines the optional Agent API boundary for EMWaver native apps.

The open-source runtime, firmware payloads, scripts, and local hardware control work without an Agent key. When enabled, the Agent can help write, run, and debug local scripts.

## Product Contract

The Agent helps with:

- probing connected modules by writing/running JavaScript/JSX scripts that use the public EMWaver script libraries,
- debugging wiring, protocol, and runtime errors,
- writing JavaScript scripts from user intent,
- turning module/datasheet behavior into script code,
- generating native UI controls for scripts,
- adapting scripts between supported boards,
- explaining console output, hardware responses, and script behavior.

The Agent must not be required for local hardware access.

Each native app should keep an Agent runtime/interface:

- macOS/iOS Agent chat surfaces,
- Windows Agent chat surface,
- Android Agent chat surface.

Those app runtimes are clients. They collect local script/device/UI/error context, manage chat UX, and call the Agent endpoint. They must not embed production system prompts or private Agent instructions.

## Authentication

Use a simple Continual MI/MGPT Agent API key.

Initial client-side configuration targets:

```text
EMWAVER_AGENT_API_KEY
EMWAVER_AGENT_ENDPOINT
```

Future persisted local configuration can use an app-local EMWaver config file or platform keychain/credential store. This key is for Agent inference only; it is not an EMWaver account.

Missing key behavior:

- All clients: show an Agent setup state while leaving local script control available. Local hardware access must never require an Agent key.

## MGPT Endpoint Shape

The Agent endpoint is MGPT's public, external stateful Responses API. EMWaver is only one client. MGPT has no notion of EMWaver, MDL, boards, scripts, flashing, or product-specific schemas at this boundary.

EMWaver must use the normal public API route. It must not call MDL-only `backend-api` routes. `/backend-api/...` is reserved for MDL's trusted internal generation path and should not be used or changed to make EMWaver Agent behavior work.

Endpoint concept:

```http
POST /api/mgpt/responses
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

EMWaver apps must not perform database reads, store prompt snapshots, serialize full universe documents, depend on MDL/MGPT cache internals, or send EMWaver-specific schemas to MGPT. Their MGPT-facing job is to call the public Agent API with `universe` and `userInput`.

If the public Agent API fails, EMWaver work should not patch MDL gameplay routes, MDL `backend-api` routes, or MGPT internals as a side effect. Fixing the public API is separate MGPT/platform API work and should be requested explicitly.

The open-source repo should keep only:

- Agent UI/runtime clients,
- endpoint/request/response contracts,
- harmless development fixtures,
- generic examples that can be public.

The open-source repo should not contain production Agent IP:

- private system prompts,
- proprietary JavaScript instruction packs,
- hidden board/module recipes,
- provider selection logic,
- metering implementation.

Prompt secrecy is not the full moat. The real moat is the maintained Agent service: high-quality EMWaver JavaScript expertise, hardware recipes, runtime-aware debugging, examples, and tight native-app integration.

## Client Integrations

Each native app Agent client:

- sends only `universe` and `userInput` to the MGPT-facing endpoint,
- folds any user-approved local context into `userInput` before the boundary when needed,
- lets users intentionally apply returned code or patch.

## Non-Goals

- Do not put paid Agent checks on local hardware control.
- Do not ship private Agent prompts in the open-source client.
- Do not make hosted cloud sessions a prerequisite for Agent help.
- Do not frame the Agent as an EMWaver-specific model line.
- Do not use MDL-only `/backend-api/...` routes from EMWaver clients.
