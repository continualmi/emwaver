import type { NextConfig } from "next";
import path from "path";
import dotenv from "dotenv";

// Dev convenience: load shared env from backend/.env if present.
// Next.js still loads frontend/.env.local normally; this is just a fallback so
// you don't have to duplicate values.
try {
  dotenv.config({ path: path.resolve(__dirname, "../backend/.env") });
} catch {}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Repo-root tracing so production builds don't pick an unrelated lockfile.
  outputFileTracingRoot: path.resolve(__dirname, ".."),

  // Explicitly expose the env vars we need to the client.
  env: {
    NEXT_PUBLIC_EMWAVER_BACKEND_URL: process.env.NEXT_PUBLIC_EMWAVER_BACKEND_URL || process.env.EMWAVER_BACKEND_URL,
    NEXT_PUBLIC_FIREBASE_API_KEY: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || process.env.FIREBASE_API_KEY,
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || process.env.FIREBASE_AUTH_DOMAIN,
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID,
    NEXT_PUBLIC_FIREBASE_APP_ID: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || process.env.FIREBASE_APP_ID,
  },
};

export default nextConfig;
