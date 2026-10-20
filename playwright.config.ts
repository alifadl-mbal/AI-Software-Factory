import { defineConfig, devices } from "@playwright/test";

import { E2E_AUTH } from "./tests/e2e/auth-env";

/**
 * End-to-end tests against the production build (`npm run build` first).
 *
 * Three servers:
 * - sample mode, no sign-in: the main suite (port `E2E_PORT`, default 3100);
 * - oracle mode with Microsoft sign-in configured (dummy tenant) and a DSN nothing listens on:
 *   the sign-in gate, cron token, health and the friendly ErrorCard (`E2E_ORACLE_PORT`, +1);
 * - oracle mode without sign-in, which must serve no data (`E2E_LOCKED_PORT`, +2).
 *
 * `E2E_SUITE=sample` runs just the first; `E2E_SUITE=oracle` the other two.
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);
const ORACLE_PORT = Number(process.env.E2E_ORACLE_PORT ?? PORT + 1);
const LOCKED_PORT = Number(process.env.E2E_LOCKED_PORT ?? PORT + 2);
const suite = process.env.E2E_SUITE ?? "all";

// Nothing listens on port 1, so every query fails to connect.
const DEAD_ORACLE = {
  MBAL_DATA_SOURCE: "oracle",
  ORACLE_USER: "e2e",
  ORACLE_PASSWORD: "e2e",
  ORACLE_DSN: "127.0.0.1:1/nosuchservice",
};

// Unset so a developer's own settings can't leak into a server that must have none.
const NO_AUTH = {
  AUTH_SECRET: "",
  AUTH_MICROSOFT_ENTRA_ID_ID: "",
  AUTH_MICROSOFT_ENTRA_ID_SECRET: "",
  AUTH_MICROSOFT_ENTRA_ID_TENANT_ID: "",
};

const server = (port: number, env: Record<string, string>) => ({
  command: `npx next start -p ${port}`,
  port,
  env,
  reuseExistingServer: false,
  timeout: 120_000,
});

const sampleServer = server(PORT, { MBAL_DATA_SOURCE: "sample", ...NO_AUTH });
const oracleServer = server(ORACLE_PORT, {
  ...DEAD_ORACLE,
  ...E2E_AUTH,
  AUTH_URL: `http://localhost:${ORACLE_PORT}`,
});
const lockedServer = server(LOCKED_PORT, { ...DEAD_ORACLE, ...NO_AUTH });

const ORACLE_SPECS = /(oracle-error|auth|locked)\.spec/;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: { trace: "retain-on-failure", ...devices["Desktop Chrome"] },
  projects: [
    ...(suite !== "oracle"
      ? [{ name: "sample", testIgnore: ORACLE_SPECS, use: { baseURL: `http://localhost:${PORT}` } }]
      : []),
    ...(suite !== "sample"
      ? [
          {
            name: "oracle",
            testMatch: /(oracle-error|auth)\.spec/,
            use: { baseURL: `http://localhost:${ORACLE_PORT}` },
          },
          { name: "locked", testMatch: /locked\.spec/, use: { baseURL: `http://localhost:${LOCKED_PORT}` } },
        ]
      : []),
  ],
  webServer: [
    ...(suite !== "oracle" ? [sampleServer] : []),
    ...(suite !== "sample" ? [oracleServer, lockedServer] : []),
  ],
});
