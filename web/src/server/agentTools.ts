import type { RemoteIncomingPayload, RemoteSessionState } from "./ws/state";
import { hostSessionsStore } from "./store/hostSessions";

export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolError";
  }
}

export function hostsList(uid: string) {
  return hostSessionsStore.list(uid);
}

export function remoteAttach(remoteState: RemoteSessionState, uid: string, hostSessionId: string) {
  const host = remoteState.getHost(uid, hostSessionId);
  if (!host) throw new ToolError("host_offline");
  remoteState.forwardToHost(uid, hostSessionId, { type: "host.attach", hostSessionId });
  return { attached: true, hostSessionId };
}

export function remoteRunScript(remoteState: RemoteSessionState, uid: string, hostSessionId: string, name: string, source: string) {
  const ok = remoteState.forwardToHost(uid, hostSessionId, {
    type: "script.run",
    hostSessionId,
    name,
    source,
  });
  if (!ok) throw new ToolError("host_offline");
  return { sent: true };
}

export async function remoteWaitForUi(remoteState: RemoteSessionState, uid: string, hostSessionId: string, minRev = 0, timeoutSeconds = 10) {
  const snapshot = await remoteState.waitForUiSnapshot(uid, hostSessionId, minRev, timeoutSeconds * 1000);
  return snapshot ? { snapshot } : { timeout: true };
}

export function remoteSendUiEvent(
  remoteState: RemoteSessionState,
  uid: string,
  payload: {
    hostSessionId: string;
    scriptInstanceId: string;
    targetNodeId: string;
    name: string;
    payload?: Record<string, unknown>;
    baseRev?: number | null;
  },
) {
  const ok = remoteState.forwardToHost(uid, payload.hostSessionId, {
    type: "ui.event",
    ...payload,
    payload: payload.payload || {},
  });
  if (!ok) throw new ToolError("host_offline");
  return { sent: true };
}

export function toolSchemasV1() {
  return [
    {
      type: "function",
      function: {
        name: "hosts_list",
        description: "List the user’s available host sessions (devices/apps).",
        parameters: { type: "object", properties: {}, additionalProperties: false },
      },
    },
    {
      type: "function",
      function: {
        name: "remote_attach",
        description: "Attach as a controller to a host session to enable remote control.",
        parameters: {
          type: "object",
          properties: { hostSessionId: { type: "string" } },
          required: ["hostSessionId"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "remote_run_script",
        description: "Run a script on an attached host. Provide script source.",
        parameters: {
          type: "object",
          properties: {
            hostSessionId: { type: "string" },
            name: { type: "string" },
            source: { type: "string" },
          },
          required: ["hostSessionId", "name", "source"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "remote_wait_for_ui",
        description: "Wait for the latest ui.snapshot from a host (rev >= minRev).",
        parameters: {
          type: "object",
          properties: {
            hostSessionId: { type: "string" },
            minRev: { type: "integer" },
            timeoutSeconds: { type: "number" },
          },
          required: ["hostSessionId"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "remote_send_ui_event",
        description: "Send a semantic UI event (tap/change/submit/select) to a node id.",
        parameters: {
          type: "object",
          properties: {
            hostSessionId: { type: "string" },
            scriptInstanceId: { type: "string" },
            targetNodeId: { type: "string" },
            name: { type: "string" },
            payload: { type: "object" },
            baseRev: { type: "integer" },
          },
          required: ["hostSessionId", "scriptInstanceId", "targetNodeId", "name"],
          additionalProperties: false,
        },
      },
    },
  ];
}
