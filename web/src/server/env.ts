function parseBool(value: string | undefined, fallback = false): boolean {
  if (!value) return fallback;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

export const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number.parseInt(process.env.PORT || "3200", 10),
  firebaseProjectId: (process.env.FIREBASE_PROJECT_ID || "").trim(),
  authDebug: parseBool(process.env.EMWAVER_AUTH_DEBUG),
};

export function hasEnv(name: string): boolean {
  return Boolean((process.env[name] || "").trim());
}
