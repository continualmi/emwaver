export type RemoteHelloAck = { type: "hello.ack"; role: "web"; hostSessionId?: string };
export type RemoteHostError = { type: "host.error"; hostSessionId?: string; error: string };

export type RemoteDeviceStatus = {
  type: "device.status";
  hostSessionId?: string;
  connected: boolean;
  runtimeOwner?: string;
  settings?: {
    selectedDeviceUid?: string | null;
    selectedDeviceId?: string | null;
    selectedTransport?: string | null;
    wifiTargets?: Array<{ host: string; port: number }>;
  };
  devices?: Array<{
    id?: string;
    deviceKey?: string | null;
    transportId?: string;
    name?: string;
    transport?: string;
    boardType?: string;
    host?: string;
    port?: number;
    endpoint?: string;
    address?: string;
    addresses?: string[];
    connected?: boolean;
    connectionState?: string;
    claimable?: boolean;
    requiresSession?: boolean;
    isActive?: boolean;
    isSelected?: boolean;
    hardwareUid?: string;
  }>;
};

export type RemoteScriptStarted = { type: "script.started"; hostSessionId: string; scriptInstanceId: string; name?: string | null; deviceId?: string | null; transportId?: string | null; warning?: string | null };
export type RemoteScriptStopped = { type: "script.stopped"; hostSessionId: string; scriptInstanceId: string; deviceId?: string | null; reason?: string | null };
export type RemoteScriptError = { type: "script.error"; hostSessionId: string; error: string; requestId?: string };

export type RemoteUiSnapshot = {
  type: "ui.snapshot";
  hostSessionId: string;
  scriptInstanceId: string;
  rev: number;
  root: RemoteUiNode | null;
  metadata?: unknown;
  deviceId?: string | null;
};

export type RemoteUiNode = {
  id: string;
  type: string;
  props?: Record<string, unknown>;
  handlers?: Record<string, string>;
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
  | RemoteDeviceStatus
  | RemoteHostError
  | RemoteScriptStarted
  | RemoteScriptStopped
  | RemoteScriptError
  | RemoteUiSnapshot
  | RemotePlotData
  | { type: string; [key: string]: unknown };

export function localGatewayWsUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/v1/ws`;
}

export function wsSend(ws: WebSocket, obj: unknown) {
  ws.send(JSON.stringify(obj));
}
