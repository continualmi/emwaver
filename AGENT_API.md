# EMWaver Agent API Direction

This document defines the first paid Agent service direction for the local-first EMWaver rebirth.

The open-source runtime, gateway, CLI, firmware payloads, scripts, and local hardware control should work without an Agent key. The Agent is optional paid assistance for writing, debugging, explaining, and improving `.emw` scripts.

## Product Contract

The Agent helps with:

- writing `.emw` scripts from user intent,
- debugging runtime errors,
- turning module/datasheet behavior into script code,
- generating UI controls for scripts,
- adapting scripts between supported boards,
- explaining hardware responses and script behavior.

The Agent must not be required for local hardware access.

Each app should keep an Agent runtime/interface:

- gateway Agent panel,
- CLI `emwaver agent`,
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

Future persisted local configuration can use an app-local EMWaver config file or platform keychain/credential store, but the environment variables are sufficient for the first CLI/gateway integration. This key is for Agent inference only; it is not an EMWaver account.

Missing key behavior:

- CLI: print a setup message and exit non-zero for Agent commands.
- Gateway UI: show an Agent setup state while leaving local script control available.

## Endpoint Shape

Initial endpoint concept:

```http
POST /v1/emwaver/agent
Authorization: Bearer <agent_api_key>
Content-Type: application/json
```

The local gateway proxy endpoint is:

```http
POST /v1/agent
```

It forwards to `EMWAVER_AGENT_ENDPOINT` with `EMWAVER_AGENT_API_KEY`. If either value is missing, it returns `agent_not_configured` and local hardware control remains available.

Request:

```json
{
  "mode": "write|debug|explain|patch",
  "prompt": "Write a script for an MFRC522 card read.",
  "script": {
    "name": "rfid.emw",
    "source": "..."
  },
  "runtime": {
    "error": "script error text",
    "logs": ["optional log lines"]
  },
  "hardware": {
    "boardType": "stm32f042",
    "modules": ["rfid-waver"],
    "connectedDevice": {
      "boardType": "stm32f042",
      "firmwareVersion": "optional"
    }
  },
  "context": {
    "selectedExample": "optional",
    "uiSnapshot": {}
  }
}
```

Response:

```json
{
  "message": "Explanation for the user.",
  "code": "optional full .emw source",
  "patch": "optional patch-style edit",
  "warnings": ["optional safety or hardware notes"],
  "usage": {
    "metered": true
  }
}
```

## Server-Side Responsibility

The Continual MI/MGPT backend should own:

- Agent system prompt,
- `.emw` language instructions,
- board/runtime rules,
- module recipes,
- safety and policy constraints,
- usage metering,
- provider/model routing.

The open-source client should send user intent and relevant context, not private system instructions.

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

Gateway:

- add an Agent panel,
- include current script source,
- include selected board/module metadata,
- include latest script error or UI snapshot when useful,
- let users intentionally apply returned code or patch.

CLI:

```bash
emwaver agent "write a script for a CC1101 433.92 MHz ASK receiver"
emwaver agent --script scripts/cc1101.emw "debug this"
```

The CLI uses `EMWAVER_AGENT_API_KEY` and `EMWAVER_AGENT_ENDPOINT` initially. `CONTINUAL_AGENT_ENDPOINT` is accepted as an endpoint fallback.

## Non-Goals

- Do not put paid Agent checks on local hardware control.
- Do not ship private Agent prompts in the open-source client.
- Do not make hosted cloud sessions a prerequisite for Agent help.
- Do not frame the Agent as an EMWaver-specific model line.
