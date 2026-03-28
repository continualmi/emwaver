function parseBool(value: string | undefined, fallback = false): boolean {
  if (!value) return fallback;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function readEnv(name: string) {
  return String(process.env[name] ?? "").trim();
}

export const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number.parseInt(process.env.PORT || "3920", 10),
  firebaseProjectId: (process.env.FIREBASE_PROJECT_ID || "").trim(),
  authDebug: parseBool(process.env.EMWAVER_AUTH_DEBUG),
  provisioningAllowedEmail: (process.env.EMWAVER_PROVISIONING_ALLOWED_EMAIL || "").trim().toLowerCase(),
  provisioningAllowedUids: (process.env.EMWAVER_PROVISIONING_ALLOWED_UIDS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
};

export function hasEnv(name: string): boolean {
  return Boolean((process.env[name] || "").trim());
}

export function getEmwaverAppUrl() {
  return readEnv("CANONICAL_APP_URL") || readEnv("NEXT_PUBLIC_SITE_URL") || "http://localhost:3920";
}

export function getModelBaseUrl() {
  return (readEnv("MODEL_BASE_URL") || "https://openrouter.ai/api/v1").replace(/\/+$/, "");
}

export function getModelApiKey() {
  return readEnv("OPENROUTER_API_KEY") || readEnv("MODEL_API_KEY");
}

export function getModelRequestTimeoutMs() {
  const raw = Number.parseInt(readEnv("MODEL_REQUEST_TIMEOUT_MS"), 10);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return 60_000;
}

export function getEmwaverSessionSecret() {
  return readEnv("EMWAVER_SESSION_SECRET")
    || readEnv("CONTINUAL_AUTH_HANDOFF_SECRET")
    || readEnv("SOCIETY_HANDOFF_SECRET");
}

export function getContinualAuthHandoffSecret() {
  return readEnv("CONTINUAL_AUTH_HANDOFF_SECRET")
    || readEnv("SOCIETY_HANDOFF_SECRET")
    || readEnv("EMWAVER_SESSION_SECRET");
}

export function getEmwaverSessionMaxAgeSeconds() {
  const raw = Number.parseInt(readEnv("EMWAVER_SESSION_MAX_AGE_SECONDS"), 10);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return 60 * 60 * 24 * 30;
}
