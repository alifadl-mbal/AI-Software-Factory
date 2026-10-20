import { execSync } from "node:child_process";

import type { NextConfig } from "next";

import pkg from "./package.json" with { type: "json" };

/** The commit being built, for `/api/health`. `unknown` outside a git checkout. */
function commit(): string {
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "unknown";
  }
}

const nextConfig: NextConfig = {
  // The Oracle driver runs only on the server and is loaded from node_modules, never bundled.
  serverExternalPackages: ["oracledb"],
  poweredByHeader: false,
  // Fixed at build time, so the health check reports what is actually running.
  env: { MBAL_VERSION: pkg.version, MBAL_COMMIT: commit() },
  turbopack: {
    root: import.meta.dirname,
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
