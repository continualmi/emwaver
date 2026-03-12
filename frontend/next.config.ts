import type { NextConfig } from "next";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";

function expandVars(input?: string): string | undefined {
  if (!input) return input;
  let out = input;
  for (let i = 0; i < 6; i += 1) {
    const next = out.replace(/\$\{([A-Z0-9_]+)\}/g, (_m, key: string) => process.env[key] ?? "");
    if (next === out) break;
    out = next;
  }
  return out;
}

function loadEnvFiles() {
  const repoRoot = path.resolve(__dirname, "..");
  const envName = (process.env.EMWAVER_ENV || process.env.NODE_ENV || "").trim().toLowerCase();
  const files = [envName === "prod" || envName === "production" ? ".env.prod" : ".env"];

  for (const rel of files) {
    const p = path.resolve(repoRoot, rel);
    if (fs.existsSync(p)) {
      dotenv.config({ path: p, override: false });
    }
  }

  const keysToExpand = [
    "EMWAVER_BACKEND_URL",
    "EMWAVER_BACKEND_URL_CLOUD",
    "EMWAVER_BACKEND_URL_LOCAL",
    "EMWAVER_FRONTEND_URL",
    "EMWAVER_FRONTEND_URL_CLOUD",
    "EMWAVER_FRONTEND_URL_LOCAL",
    "NEXT_PUBLIC_EMWAVER_BACKEND_URL",
    "NEXT_PUBLIC_EMWAVER_BACKEND_URL_CLOUD",
    "NEXT_PUBLIC_EMWAVER_BACKEND_URL_LOCAL",
    "NEXT_PUBLIC_EMWAVER_STAFF_ONLY",
  ];

  for (const key of keysToExpand) {
    const val = process.env[key];
    const expanded = expandVars(val);
    if (expanded !== undefined) process.env[key] = expanded;
  }
}

loadEnvFiles();

function expandEnvReferences() {
  const varPattern = /\$\{([A-Z0-9_]+)\}/gi;
  for (let i = 0; i < 10; i++) {
    let changed = false;
    for (const [key, value] of Object.entries(process.env)) {
      if (typeof value !== "string" || !value.includes("${")) continue;
      const next = value.replace(varPattern, (_, varName: string) => process.env[varName] || "");
      if (next !== value) {
        process.env[key] = next;
        changed = true;
      }
    }
    if (!changed) break;
  }
}

expandEnvReferences();

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: path.resolve(__dirname, ".."),
  env: {
    NEXT_PUBLIC_EMWAVER_BACKEND_URL:
      process.env.NEXT_PUBLIC_EMWAVER_BACKEND_URL || process.env.EMWAVER_BACKEND_URL,
    NEXT_PUBLIC_EMWAVER_BACKEND_URL_CLOUD:
      process.env.NEXT_PUBLIC_EMWAVER_BACKEND_URL_CLOUD || process.env.EMWAVER_BACKEND_URL_CLOUD,
    NEXT_PUBLIC_EMWAVER_BACKEND_URL_LOCAL:
      process.env.NEXT_PUBLIC_EMWAVER_BACKEND_URL_LOCAL || process.env.EMWAVER_BACKEND_URL_LOCAL,
    NEXT_PUBLIC_EMWAVER_STAFF_ONLY:
      process.env.NEXT_PUBLIC_EMWAVER_STAFF_ONLY || process.env.EMWAVER_STAFF_ONLY,
    NEXT_PUBLIC_FIREBASE_API_KEY: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || process.env.FIREBASE_API_KEY,
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN:
      process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || process.env.FIREBASE_AUTH_DOMAIN,
    NEXT_PUBLIC_FIREBASE_PROJECT_ID:
      process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID,
    NEXT_PUBLIC_FIREBASE_APP_ID: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || process.env.FIREBASE_APP_ID,
  },
};

export default nextConfig;
