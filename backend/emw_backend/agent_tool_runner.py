from __future__ import annotations

import json
from typing import Any, Dict

from emw_backend.agent_tools import ToolError, hosts_list, remote_attach, remote_run_script, remote_send_ui_event, remote_wait_for_ui


def run_tool(*, uid: str, name: str, arguments_json: str) -> Dict[str, Any]:
    try:
        args = json.loads(arguments_json or "{}")
    except Exception:
        args = {}
    if not isinstance(args, dict):
        args = {}

    try:
        if name == "hosts_list":
            return hosts_list(uid=uid)
        if name == "remote_attach":
            return remote_attach(uid=uid, hostSessionId=str(args.get("hostSessionId") or ""))
        if name == "remote_run_script":
            return remote_run_script(
                uid=uid,
                hostSessionId=str(args.get("hostSessionId") or ""),
                name=str(args.get("name") or ""),
                source=str(args.get("source") or ""),
            )
        if name == "remote_wait_for_ui":
            return remote_wait_for_ui(
                uid=uid,
                hostSessionId=str(args.get("hostSessionId") or ""),
                minRev=int(args.get("minRev") or 0),
                timeoutSeconds=float(args.get("timeoutSeconds") or 10.0),
            )
        if name == "remote_send_ui_event":
            return remote_send_ui_event(
                uid=uid,
                hostSessionId=str(args.get("hostSessionId") or ""),
                scriptInstanceId=str(args.get("scriptInstanceId") or ""),
                targetNodeId=str(args.get("targetNodeId") or ""),
                name=str(args.get("name") or ""),
                payload=(args.get("payload") if isinstance(args.get("payload"), dict) else {}),
                baseRev=(int(args.get("baseRev")) if args.get("baseRev") is not None else None),
            )

        return {"error": f"unknown_tool:{name}"}

    except ToolError as te:
        return {"error": te.message}
    except Exception as e:
        return {"error": str(e)}
