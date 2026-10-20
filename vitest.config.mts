import path from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": import.meta.dirname,
      // `server-only` throws outside the React server build; tests run server code directly.
      "server-only": path.join(import.meta.dirname, "tests", "server-only-stub.ts"),
    },
  },
  test: {
    include: ["tests/unit/**/*.test.{ts,tsx}"],
    setupFiles: ["tests/setup.ts"],
    env: { MBAL_DATA_SOURCE: "sample", TZ: "Asia/Dubai" },
  },
});
