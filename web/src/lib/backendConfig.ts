const ENV_BACKEND_URL = (
  process.env.NEXT_PUBLIC_EMWAVER_BACKEND_URL ||
  process.env.EMWAVER_BACKEND_URL ||
  ""
).trim().replace(/\/+$/, "");

export function defaultBackendBaseUrl(): string {
  if (typeof window !== "undefined") {
    return window.location.origin.replace(/\/+$/, "");
  }
  return ENV_BACKEND_URL;
}

export function getBackendBaseUrl(): string {
  return defaultBackendBaseUrl();
}
