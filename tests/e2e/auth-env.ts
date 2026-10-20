/**
 * Dummy Microsoft sign-in settings for the oracle e2e server. Nothing here is a real secret: the
 * tenant and client don't exist, so no test ever reaches Microsoft. Sessions are minted locally
 * with `AUTH_SECRET` instead (see `signIn` in helpers.ts).
 */
export const E2E_GROUP = "0f0e0d0c-0b0a-4908-8706-050403020100";

export const E2E_AUTH = {
  AUTH_SECRET: "e2e-only-auth-secret-not-used-anywhere-else-0123456789",
  AUTH_MICROSOFT_ENTRA_ID_ID: "00000000-0000-0000-0000-00000000c11e",
  AUTH_MICROSOFT_ENTRA_ID_SECRET: "e2e-dummy-client-secret",
  AUTH_MICROSOFT_ENTRA_ID_TENANT_ID: "00000000-0000-0000-0000-0000000000aa",
  AUTH_ALLOWED_GROUP: E2E_GROUP,
  CRON_SECRET: "e2e-cron-secret",
};
