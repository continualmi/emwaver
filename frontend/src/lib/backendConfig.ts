const KEY = "emwaver.cloud.backendUrlOverride";

export const CLOUD_BACKEND_URL = (
  process.env.NEXT_PUBLIC_EMWAVER_BACKEND_URL_CLOUD ||
  process.env.NEXT_PUBLIC_EMWAVER_BACKEND_URL ||
  process.env.EMWAVER_BACKEND_URL ||
  "https://emwaver-backend.delightfuldune-64bd11df.westeurope.azurecontainerapps.io"
).trim().replace(/\/+$/, "");

export const LOCAL_BACKEND_URL = (
  process.env.NEXT_PUBLIC_EMWAVER_BACKEND_URL_LOCAL ||
  "http://127.0.0.1:3201"
).trim().replace(/\/+$/, "");

export const STAFF_ONLY_ENABLED = ((process.env.NEXT_PUBLIC_EMWAVER_STAFF_ONLY || "0").trim() === "1");

export function defaultBackendBaseUrl(): string {
  return CLOUD_BACKEND_URL;
}

export function getBackendBaseUrl(): string {
  // Client-side override (persists across launches).
  if (typeof window !== "undefined") {
    try {
      const v = (window.localStorage.getItem(KEY) || "").trim();
      if (v) return v.replace(/\/+$/, "");
    } catch {
      // ignore
    }
  }
  return defaultBackendBaseUrl();
}

export function setBackendBaseUrlOverride(url: string) {
  if (typeof window === "undefined") return;
  const v = (url || "").trim().replace(/\/+$/, "");
  try {
    if (!v) window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, v);
  } catch {
    // ignore
  }
}

export function clearBackendBaseUrlOverride() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

export function getBackendOverrideRaw(): string {
  if (typeof window === "undefined") return "";
  try {
    return (window.localStorage.getItem(KEY) || "").trim();
  } catch {
    return "";
  }
}
