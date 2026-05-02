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

## Authentication

Use a simple Continual MI Agent API key.

Initial client-side configuration targets:

```text
EMWAVER_AGENT_API_KEY
```

Future persisted local configuration can use an EMWaver config file, but the environment variable is sufficient for the first CLI/gateway integration.

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

The Continual MI backend should own:

- Agent system prompt,
- `.emw` language instructions,
- board/runtime rules,
- module recipes,
- safety and policy constraints,
- usage metering,
- provider/model routing.

The open-source client should send user intent and relevant context, not private system instructions.

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
