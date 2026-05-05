import type { NextConfig } from "next";
import path from "node:path";

const staticExportEnabled = process.env.EMWAVER_STATIC_EXPORT === "1";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: path.resolve(__dirname),
  ...(staticExportEnabled
    ? {
        output: "export" as const,
        trailingSlash: true,
        images: {
          unoptimized: true,
        },
      }
    : {}),
};

export default nextConfig;
