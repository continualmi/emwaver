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

  const res = await fetch(url, { ...init, headers, cache: "no-store", credentials: "include" });
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
    credentials: "include",
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
    credentials: "include",
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
