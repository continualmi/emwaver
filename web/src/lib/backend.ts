import { getBackendBaseUrl } from "./backendConfig";

export function backendBaseUrl(): string {
  return getBackendBaseUrl();
}

export async function backendFetch(path: string, idToken: string, init?: RequestInit) {
  const url = `${backendBaseUrl()}${path.startsWith("/") ? "" : "/"}${path}`;
  const headers = new Headers(init?.headers || undefined);
  headers.set("Accept", "application/json");
  if (!(init?.body instanceof FormData)) {
    if (!headers.has("Content-Type") && init?.body) {
      headers.set("Content-Type", "application/json");
    }
  }
  if (idToken) {
    headers.set("Authorization", `Bearer ${idToken}`);
  }

  const res = await fetch(url, { ...init, headers, cache: "no-store" });
  return res;
}

export type CloudUserFile = {
  name: string;
  blob_key: string;
  etag?: string | null;
  size_bytes?: number | null;
  content_type?: string | null;
  mtime_ms?: number | null;
};

export async function listFiles(idToken: string): Promise<CloudUserFile[]> {
  const res = await backendFetch("/v1/files", idToken, { method: "GET" });
  const text = await res.text();
  if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
  const json = JSON.parse(text);
  return json.files || [];
}

export async function downloadFileContent(name: string, idToken: string): Promise<ArrayBuffer> {
  const url = new URL(`${backendBaseUrl()}/v1/files/content`);
  url.searchParams.set("name", name);
  const res = await fetch(url.toString(), {
    method: "GET",
    headers: idToken ? { Authorization: `Bearer ${idToken}` } : {},
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
  return await res.arrayBuffer();
}

export async function uploadFile(name: string, bytes: Uint8Array, contentType: string, mtimeMs: number, idToken: string) {
  const payload = {
    name,
    content_type: contentType,
    data_base64: Buffer.from(bytes).toString("base64"),
    mtime_ms: mtimeMs,
  };
  const res = await backendFetch("/v1/files/upload", idToken, { method: "POST", body: JSON.stringify(payload) });
  const text = await res.text();
  if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
  return JSON.parse(text);
}

export async function deleteFile(name: string, idToken: string) {
  const url = new URL(`${backendBaseUrl()}/v1/files`);
  url.searchParams.set("name", name);
  const res = await fetch(url.toString(), {
    method: "DELETE",
    headers: {
      Accept: "application/json",
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
}

// --- Agent (chat) ---

export type AgentConversation = {
  id: string;
  title?: string | null;
  created_at_ms: number;
  updated_at_ms: number;
};

export type AgentMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at_ms: number;
};

export async function listAgentConversations(idToken: string): Promise<AgentConversation[]> {
  const res = await backendFetch("/v1/agent/conversations", idToken, { method: "GET" });
  const text = await res.text();
  if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
  const json = JSON.parse(text);
  return json.conversations || [];
}

export async function createAgentConversation(idToken: string, title?: string): Promise<AgentConversation> {
  const res = await backendFetch("/v1/agent/conversations", idToken, {
    method: "POST",
    body: JSON.stringify({ title }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
  const json = JSON.parse(text);
  return json.conversation;
}

export async function listAgentMessages(idToken: string, conversationId: string): Promise<AgentMessage[]> {
  const res = await backendFetch(`/v1/agent/conversations/${encodeURIComponent(conversationId)}/messages`, idToken, {
    method: "GET",
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
  const json = JSON.parse(text);
  return json.messages || [];
}

export async function agentChat(idToken: string, conversationId: string, message: string) {
  const res = await backendFetch("/v1/agent/chat", idToken, {
    method: "POST",
    body: JSON.stringify({ conversation_id: conversationId, message }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
  return JSON.parse(text) as { message: AgentMessage; model: string };
}

// Streaming: returns an async iterator of events.
export type AgentStreamEvent =
  | { type: "delta"; text: string }
  | { type: "tool"; name: string; payload: unknown }
  | { type: "done"; message: AgentMessage; model?: string | null }
  | { type: "error"; error: string };

// --- Host sessions ---

export type HostSession = {
  id: string;
  platform: string;
  device_name: string;
  app_version: string;
  capabilities: unknown;
  status: unknown;
  created_at_ms: number;
  last_seen_at_ms: number;
  online: boolean;
};

export async function listHostSessions(idToken: string): Promise<{ hosts: HostSession[]; now_ms: number }> {
  const res = await backendFetch("/v1/hosts", idToken, { method: "GET" });
  const text = await res.text();
  if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
  const json = JSON.parse(text);
  return { hosts: json.hosts || [], now_ms: json.now_ms || Date.now() };
}

export async function* agentChatStream(
  idToken: string,
  conversationId: string,
  message: string,
): AsyncGenerator<AgentStreamEvent> {
  const url = `${backendBaseUrl()}/v1/agent/chat/stream_tools`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "text/event-stream",
      "Content-Type": "application/json",
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
    },
    body: JSON.stringify({ conversation_id: conversationId, message }),
  });

  if (!res.ok || !res.body) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");

  let buf = "";

  function flushEvent(block: string): AgentStreamEvent | null {
    // SSE block separated by blank line
    const lines = block.split(/\r?\n/);
    let ev = "message";
    const dataLines: string[] = [];
    for (const ln of lines) {
      if (ln.startsWith("event:")) ev = ln.slice("event:".length).trim();
      else if (ln.startsWith("data:")) dataLines.push(ln.slice("data:".length).trim());
    }
    const dataRaw = dataLines.join("\n");
    if (!dataRaw) return null;
    try {
      const obj = JSON.parse(dataRaw);
      if (ev === "delta") return { type: "delta", text: String(obj.text || "") };
      if (ev === "tool") return { type: "tool", name: String(obj.name || "tool"), payload: obj.result ?? obj.arguments ?? null };
      if (ev === "done") return { type: "done", message: obj.message, model: obj.model };
      if (ev === "error") return { type: "error", error: String(obj.error || "error") };
      return null;
    } catch {
      return null;
    }
  }

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    while (true) {
      const idx = buf.indexOf("\n\n");
      if (idx === -1) break;
      const block = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const ev = flushEvent(block);
      if (ev) yield ev;
    }
  }
}
