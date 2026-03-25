import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type RawData, type WebSocket } from "ws";

import { verifyContinualHandoffToken, verifySessionToken } from "../session";
import { hostSessionsStore } from "../store/hostSessions";
import type { RemoteConnection, RemoteSessionState } from "./state";

type UpgradeContext = {
  req: IncomingMessage;
  socket: Duplex;
  head: Buffer;
  wsServer: WebSocketServer;
  remoteState: RemoteSessionState;
};

function sendJson(socket: WebSocket, payload: Record<string, unknown>) {
  socket.send(JSON.stringify(payload));
}

function parseMessage(raw: RawData): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(String(raw));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function tokenFromRequest(req: IncomingMessage): string {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const authHeader = (req.headers.authorization || "").trim();
  if (authHeader.toLowerCase().startsWith("bearer ")) {
    return authHeader.slice("bearer ".length).trim();
  }
  const cookieHeader = String(req.headers.cookie || "");
  for (const part of cookieHeader.split(";")) {
    const [rawName, ...rest] = part.split("=");
    if (rawName?.trim() === "emwaver_session") {
      return rest.join("=").trim();
    }
  }
  return (url.searchParams.get("token") || "").trim();
}

function forwardJson(socket: WebSocket, payload: Record<string, unknown>) {
  try {
    sendJson(socket, payload);
  } catch {
    socket.close();
  }
}

export async function handleWebSocketUpgrade({ req, socket, head, wsServer, remoteState }: UpgradeContext) {
  const token = tokenFromRequest(req);
  const identity = verifySessionToken(token) || verifyContinualHandoffToken(token);
  if (!identity) {
    socket.destroy();
    return;
  }

  wsServer.handleUpgrade(req, socket, head, (ws) => {
    let connection: RemoteConnection | null = null;

    ws.once("message", (raw) => {
      const hello = parseMessage(raw);
      const role = String(hello?.role || "").trim().toLowerCase();
      const hostSessionId = String(hello?.hostSessionId || "").trim() || undefined;

      if (!hello || hello.type !== "hello" || (role !== "host" && role !== "web")) {
        sendJson(ws, { type: "error", error: "expected_hello" });
        ws.close();
        return;
      }

      connection = {
        connectionId: crypto.randomUUID(),
        socket: ws,
        uid: identity.uid,
        role: role as "host" | "web",
        hostSessionId,
      };

      if (connection.role === "host") {
        if (!hostSessionId) {
          sendJson(ws, { type: "error", error: "missing_hostSessionId" });
          ws.close();
          return;
        }
        if (!hostSessionsStore.belongsTo(identity.uid, hostSessionId)) {
          sendJson(ws, { type: "error", error: "unknown_hostSessionId" });
          ws.close();
          return;
        }
        remoteState.registerHost(connection);
        sendJson(ws, { type: "hello.ack", role: "host", hostSessionId });
      } else {
        remoteState.registerWeb(connection);
        sendJson(ws, { type: "hello.ack", role: "web" });
      }

      ws.on("message", (messageRaw) => {
        if (!connection) return;
        const message = parseMessage(messageRaw);
        if (!message) {
          sendJson(ws, { type: "error", error: "invalid_json" });
          return;
        }

        const messageType = String(message.type || "");
        if (connection.role === "web") {
          const hostId = String(message.hostSessionId || "").trim();
          if (!hostId) {
            sendJson(ws, { type: "host.error", error: "missing_hostSessionId" });
            return;
          }

          if (messageType === "host.attach") {
            remoteState.subscribeWeb(connection, hostId);
            const host = remoteState.getHost(connection.uid, hostId);
            if (!host) {
              sendJson(ws, { type: "host.error", hostSessionId: hostId, error: "host_offline" });
              return;
            }
            forwardJson(host.socket, { type: "host.attach", hostSessionId: hostId });
            sendJson(ws, { type: "host.attached", hostSessionId: hostId });
            return;
          }

          const host = remoteState.getHost(connection.uid, hostId);
          if (!host) {
            sendJson(ws, { type: "host.error", hostSessionId: hostId, error: "host_offline" });
            return;
          }
          forwardJson(host.socket, message);
          return;
        }

        const hostSessionId = connection.hostSessionId;
        if (!hostSessionId) return;
        remoteState.recordHostMessage(connection.uid, hostSessionId, message);
        for (const web of remoteState.getSubscribedWebs(connection.uid, hostSessionId)) {
          forwardJson(web.socket, message);
        }
      });
    });

    ws.on("close", () => {
      if (connection) remoteState.unregister(connection);
    });
  });
}
