import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests against the production build (`npm run build` first).
 *
 * Two servers: one in sample mode for the main suite, and one in oracle mode pointed at a DSN
 * nothing listens on, to check the friendly ErrorCard. `E2E_SUITE=sample` or `E2E_SUITE=oracle`
 * runs just one of them (handy when only one port is free).
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);
const ORACLE_PORT = Number(process.env.E2E_ORACLE_PORT ?? PORT + 1);
const suite = process.env.E2E_SUITE ?? "all";

const sampleServer = {
  command: `npx next start -p ${PORT}`,
  url: `http://localhost:${PORT}/`,
  env: { MBAL_DATA_SOURCE: "sample" },
  reuseExistingServer: false,
  timeout: 120_000,
};

const oracleServer = {
  command: `npx next start -p ${ORACLE_PORT}`,
  url: `http://localhost:${ORACLE_PORT}/`,
  env: {
    MBAL_DATA_SOURCE: "oracle",
    ORACLE_USER: "e2e",
    ORACLE_PASSWORD: "e2e",
    // Nothing listens on port 1, so every query fails to connect.
    ORACLE_DSN: "127.0.0.1:1/nosuchservice",
  },
  reuseExistingServer: false,
  timeout: 120_000,
};

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
      ? [{ name: "sample", testIgnore: /oracle-error/, use: { baseURL: `http://localhost:${PORT}` } }]
      : []),
    ...(suite !== "sample"
      ? [{ name: "oracle", testMatch: /oracle-error/, use: { baseURL: `http://localhost:${ORACLE_PORT}` } }]
      : []),
  ],
  webServer: [...(suite !== "oracle" ? [sampleServer] : []), ...(suite !== "sample" ? [oracleServer] : [])],
});
