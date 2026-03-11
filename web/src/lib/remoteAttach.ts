import type { RemoteIncomingMessage } from "@/lib/remoteSessions";
import { backendWsUrl, wsSend } from "@/lib/remoteSessions";

export type AttachCallbacks = {
  onStatus: (s: "disconnected" | "connecting" | "open" | "error" | "closed") => void;
  onAttachedHostId: (id: string) => void;
  onScriptStarted: (scriptInstanceId: string) => void;
  onUiSnapshot: (scriptInstanceId: string, rev: number, root: any) => void;
  onError: (msg: string) => void;
};

export function connectAndAttachWeb(
  idToken: string,
  hostSessionId: string,
  callbacks: AttachCallbacks,
): WebSocket {
  callbacks.onStatus("connecting");
  const ws = new WebSocket(backendWsUrl(idToken));

  ws.onopen = () => {
    callbacks.onStatus("open");
    wsSend(ws, { type: "hello", role: "web", protocolVersion: 1 });
    wsSend(ws, { type: "host.attach", hostSessionId });
  };

  ws.onclose = () => callbacks.onStatus("closed");
  ws.onerror = () => callbacks.onStatus("error");

  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(String(ev.data || "{}")) as RemoteIncomingMessage;
      if (!msg || typeof msg.type !== "string") return;

      if (msg.type === "host.attached") {
        callbacks.onAttachedHostId(msg.hostSessionId);
        return;
      }
      if (msg.type === "host.error") {
        callbacks.onError(`host error: ${msg.error}`);
        return;
      }
      if (msg.type === "script.started") {
        callbacks.onScriptStarted(msg.scriptInstanceId);
        return;
      }
      if (msg.type === "ui.snapshot") {
        callbacks.onUiSnapshot(msg.scriptInstanceId, msg.rev, msg.root);
        return;
      }
      if (msg.type === "script.error") {
        callbacks.onError(`script error: ${msg.error}`);
        return;
      }
      if (msg.type === "error") {
        callbacks.onError(String((msg as any).error || "error"));
        return;
      }
    } catch {
      // ignore
    }
  };

  return ws;
}
