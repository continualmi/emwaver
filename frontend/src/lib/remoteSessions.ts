export type RemoteHelloAck = { type: "hello.ack"; role: "web" | "host"; hostSessionId?: string };

export type RemoteHostAttached = { type: "host.attached"; hostSessionId: string };
export type RemoteHostError = { type: "host.error"; hostSessionId?: string; error: string };

export type RemoteScriptStarted = { type: "script.started"; hostSessionId: string; scriptInstanceId: string; name?: string | null };
export type RemoteScriptStopped = { type: "script.stopped"; hostSessionId: string; scriptInstanceId: string; reason?: string | null };
export type RemoteScriptError = { type: "script.error"; hostSessionId: string; error: string; requestId?: string };

export type RemoteUiSnapshot = {
  type: "ui.snapshot";
  hostSessionId: string;
  scriptInstanceId: string;
  rev: number;
  root: RemoteUiNode | null;
  metadata?: any;
};

export type RemoteUiNode = {
  id: string;
  type: string;
  props?: Record<string, any>;
  handlers?: Record<string, string>; // eventName -> token (optional for UI enablement)
  children?: RemoteUiNode[];
};

export type RemotePlotData = {
  type: "plot.data";
  hostSessionId: string;
  scriptInstanceId: string;
  targetNodeId: string;
  xBoundsMin?: number;
  xBoundsMax?: number;
  xMin?: number;
  xMax?: number;
  bins?: number;
  dataX?: number[];
  dataY?: number[];
  error?: string;
};

export type RemoteIncomingMessage =
  | RemoteHelloAck
  | RemoteHostAttached
  | RemoteHostError
  | RemoteScriptStarted
  | RemoteScriptStopped
  | RemoteScriptError
  | RemoteUiSnapshot
  | RemotePlotData
  | { type: string; [k: string]: any };

export function backendWsUrl(idToken: string): string {
  const raw = (process.env.NEXT_PUBLIC_EMWAVER_BACKEND_URL || "").trim();
  if (!raw) throw new Error("Missing NEXT_PUBLIC_EMWAVER_BACKEND_URL");
  const u = new URL(raw);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  u.pathname = `/v1/ws`;
  u.searchParams.set("token", idToken);
  return u.toString();
}

export function wsSend(ws: WebSocket, obj: any) {
  ws.send(JSON.stringify(obj));
}
