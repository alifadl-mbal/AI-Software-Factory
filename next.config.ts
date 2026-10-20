import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Oracle driver runs only on the server and is loaded from node_modules, never bundled.
  serverExternalPackages: ["oracledb"],
  poweredByHeader: false,
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
