export function backendBaseUrl(): string {
  const raw = (process.env.NEXT_PUBLIC_EMWAVER_BACKEND_URL || "").trim();
  if (!raw) throw new Error("Missing NEXT_PUBLIC_EMWAVER_BACKEND_URL");
  return raw.replace(/\/+$/, "");
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
