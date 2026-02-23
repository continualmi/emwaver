import type { NextConfig } from "next";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";

function loadEnvFiles() {
  const repoRoot = path.resolve(__dirname, "..");
  const files = [
    "secrets/shared/core.env",
    "secrets/shared/firebase.env",
    "secrets/shared/oauth.env",
    "secrets/targets/frontend.env",
  ];

  for (const rel of files) {
    const p = path.resolve(repoRoot, rel);
    if (fs.existsSync(p)) {
      dotenv.config({ path: p, override: false });
    }
  }
}

loadEnvFiles();

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
