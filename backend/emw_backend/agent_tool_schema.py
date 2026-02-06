from __future__ import annotations

from typing import Any, Dict, List


def tool_schemas_v1() -> List[Dict[str, Any]]:
    """OpenAI Chat Completions tool schema (functions).

    This matches OpenAI's tool-calling format:
    tools=[{"type":"function","function":{name,description,parameters}}]
    """

    return [
        {
            "type": "function",
            "function": {
                "name": "hosts_list",
                "description": "List the user’s available host sessions (devices/apps).",
                "parameters": {
                    "type": "object",
                    "properties": {},
                    "additionalProperties": False,
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "remote_attach",
                "description": "Attach as a controller to a host session to enable remote control.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "hostSessionId": {"type": "string"},
                    },
                    "required": ["hostSessionId"],
                    "additionalProperties": False,
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "remote_run_script",
                "description": "Run a script on an attached host. Provide script source.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "hostSessionId": {"type": "string"},
                        "name": {"type": "string"},
                        "source": {"type": "string"},
                    },
                    "required": ["hostSessionId", "name", "source"],
                    "additionalProperties": False,
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "remote_wait_for_ui",
                "description": "Wait for the latest ui.snapshot from a host (rev >= minRev).",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "hostSessionId": {"type": "string"},
                        "minRev": {"type": "integer"},
                        "timeoutSeconds": {"type": "number"},
                    },
                    "required": ["hostSessionId"],
                    "additionalProperties": False,
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "remote_send_ui_event",
                "description": "Send a semantic UI event (tap/change/submit/select) to a node id.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "hostSessionId": {"type": "string"},
                        "scriptInstanceId": {"type": "string"},
                        "targetNodeId": {"type": "string"},
                        "name": {"type": "string"},
                        "payload": {"type": "object"},
                        "baseRev": {"type": "integer"},
                    },
                    "required": ["hostSessionId", "scriptInstanceId", "targetNodeId", "name"],
                    "additionalProperties": False,
                },
            },
        },
    ]
