function parseBool(value: string | undefined, fallback = false): boolean {
  if (!value) return fallback;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
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
