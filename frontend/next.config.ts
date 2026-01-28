import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Repo-root tracing so production builds don't pick an unrelated lockfile.
  outputFileTracingRoot: path.resolve(__dirname, ".."),
};

export default nextConfig;
