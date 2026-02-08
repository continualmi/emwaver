const KEY = "emwaver.cloud.backendUrlOverride";

// Canonical production backend (Azure Container Apps).
export const AZURE_PRODUCTION_BACKEND_URL = "https://emwaver-backend.delightfuldune-64bd11df.westeurope.azurecontainerapps.io";

export function defaultBackendBaseUrl(): string {
  // Prefer build-time injected URL (prod/deployed backend by default).
  const raw = (process.env.NEXT_PUBLIC_EMWAVER_BACKEND_URL || process.env.EMWAVER_BACKEND_URL || "").trim();
  if (!raw) {
    throw new Error("Missing NEXT_PUBLIC_EMWAVER_BACKEND_URL");
  }
  return raw.replace(/\/+$/, "");
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
