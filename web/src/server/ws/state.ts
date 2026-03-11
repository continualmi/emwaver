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
};

export function memoryRemoteSessionState(): RemoteSessionState {
  const hosts = new Map<string, RemoteConnection>();
  const websByUid = new Map<string, Map<string, RemoteConnection>>();
  const subscriptions = new Map<string, Set<string>>();

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
  };
}
