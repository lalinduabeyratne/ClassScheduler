import path from "node:path";
import type { NextConfig } from "next";

// Avoid tracing the wrong workspace when a parent folder has its own lockfile.
const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: path.join(__dirname),
  experimental: {
    devtoolSegmentExplorer: false,
  },
};

export default nextConfig;

