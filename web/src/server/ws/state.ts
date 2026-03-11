import type { WebSocket } from "ws";

export type RemoteRole = "host" | "web";

export type RemoteConnection = {
  connectionId: string;
  socket: WebSocket;
  uid: string;
  role: RemoteRole;
  hostSessionId?: string;
};

export type RemoteSessionState = {
  registerHost(connection: RemoteConnection): void;
  registerWeb(connection: RemoteConnection): void;
  unregister(connection: RemoteConnection): void;
  subscribeWeb(connection: RemoteConnection, hostSessionId: string): void;
  getHost(uid: string, hostSessionId: string): RemoteConnection | null;
  getSubscribedWebs(uid: string, hostSessionId: string): RemoteConnection[];
  forwardToHost(uid: string, hostSessionId: string, payload: Record<string, unknown>): boolean;
  recordHostMessage(uid: string, hostSessionId: string, payload: RemoteIncomingPayload): void;
  getLatestScriptStarted(uid: string, hostSessionId: string): RemoteIncomingPayload | null;
  getLatestUiSnapshot(uid: string, hostSessionId: string): RemoteIncomingPayload | null;
  waitForUiSnapshot(uid: string, hostSessionId: string, minRev: number, timeoutMs: number): Promise<RemoteIncomingPayload | null>;
};

export type RemoteIncomingPayload = Record<string, unknown>;

export function memoryRemoteSessionState(): RemoteSessionState {
  const hosts = new Map<string, RemoteConnection>();
  const websByUid = new Map<string, Map<string, RemoteConnection>>();
  const subscriptions = new Map<string, Set<string>>();
  const latestScriptStarted = new Map<string, RemoteIncomingPayload>();
  const latestUiSnapshot = new Map<string, RemoteIncomingPayload>();

  function hostKey(uid: string, hostSessionId: string) {
    return `${uid}:${hostSessionId}`;
  }

  return {
    registerHost(connection) {
      if (!connection.hostSessionId) return;
      hosts.set(hostKey(connection.uid, connection.hostSessionId), connection);
    },
    registerWeb(connection) {
      const webs = websByUid.get(connection.uid) || new Map<string, RemoteConnection>();
      webs.set(connection.connectionId, connection);
      websByUid.set(connection.uid, webs);
      subscriptions.set(connection.connectionId, new Set<string>());
    },
    unregister(connection) {
      if (connection.hostSessionId) {
        hosts.delete(hostKey(connection.uid, connection.hostSessionId));
      }
      const webs = websByUid.get(connection.uid);
      webs?.delete(connection.connectionId);
      subscriptions.delete(connection.connectionId);
    },
    subscribeWeb(connection, hostSessionId) {
      const subs = subscriptions.get(connection.connectionId) || new Set<string>();
      subs.add(hostSessionId);
      subscriptions.set(connection.connectionId, subs);
    },
    getHost(uid, hostSessionId) {
      return hosts.get(hostKey(uid, hostSessionId)) || null;
    },
    getSubscribedWebs(uid, hostSessionId) {
      const webs = websByUid.get(uid);
      if (!webs) return [];
      return [...webs.values()].filter((connection) => subscriptions.get(connection.connectionId)?.has(hostSessionId));
    },
    forwardToHost(uid, hostSessionId, payload) {
      const host = hosts.get(hostKey(uid, hostSessionId));
      if (!host) return false;
      try {
        host.socket.send(JSON.stringify(payload));
        return true;
      } catch {
        return false;
      }
    },
    recordHostMessage(uid, hostSessionId, payload) {
      const key = hostKey(uid, hostSessionId);
      const messageType = String(payload.type || "");
      if (messageType === "script.started") latestScriptStarted.set(key, payload);
      if (messageType === "ui.snapshot") latestUiSnapshot.set(key, payload);
    },
    getLatestScriptStarted(uid, hostSessionId) {
      return latestScriptStarted.get(hostKey(uid, hostSessionId)) || null;
    },
    getLatestUiSnapshot(uid, hostSessionId) {
      return latestUiSnapshot.get(hostKey(uid, hostSessionId)) || null;
    },
    async waitForUiSnapshot(uid, hostSessionId, minRev, timeoutMs) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const snapshot = latestUiSnapshot.get(hostKey(uid, hostSessionId));
        if (snapshot) {
          const rev = Number.parseInt(String(snapshot.rev ?? 0), 10) || 0;
          if (rev >= minRev) return snapshot;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return null;
    },
  };
}

const globalRemoteState = globalThis as typeof globalThis & {
  __emwaverRemoteSessionState?: RemoteSessionState;
};

export function getRemoteSessionState(): RemoteSessionState {
  if (!globalRemoteState.__emwaverRemoteSessionState) {
    globalRemoteState.__emwaverRemoteSessionState = memoryRemoteSessionState();
  }
  return globalRemoteState.__emwaverRemoteSessionState;
}
