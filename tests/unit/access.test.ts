import { describe, expect, it } from "vitest";

import {
  accessMode,
  authEnabled,
  cronAuthorized,
  groupAllows,
  isPublicPath,
  safeCallbackPath,
} from "@/lib/server/access";

const GROUP = "6f1c2a7e-0b4d-4c1e-9a55-3c1f0e2d7b90";
const AUTH = {
  AUTH_SECRET: "s",
  AUTH_MICROSOFT_ENTRA_ID_ID: "client",
  AUTH_MICROSOFT_ENTRA_ID_SECRET: "secret",
  AUTH_MICROSOFT_ENTRA_ID_TENANT_ID: "tenant",
};

describe("groupAllows", () => {
  it("lets a member of the configured group in", () => {
    expect(groupAllows(GROUP, ["11111111-2222-3333-4444-555555555555", GROUP])).toBe(true);
    expect(groupAllows(GROUP, [GROUP.toUpperCase()])).toBe(true);
  });

  it("keeps a non-member out", () => {
    expect(groupAllows(GROUP, ["11111111-2222-3333-4444-555555555555"])).toBe(false);
    expect(groupAllows(GROUP, [])).toBe(false);
    // No groups claim at all (not configured on the app registration, or too many groups).
    expect(groupAllows(GROUP, undefined)).toBe(false);
    expect(groupAllows(GROUP, "not-a-list")).toBe(false);
  });

  it("lets everyone in the tenant in when no group is configured", () => {
    expect(groupAllows(undefined, undefined)).toBe(true);
    expect(groupAllows(undefined, [])).toBe(true);
    expect(groupAllows(undefined, ["11111111-2222-3333-4444-555555555555"])).toBe(true);
  });
});

describe("accessMode", () => {
  it("is auth once every Entra variable is set, in any data mode", () => {
    expect(authEnabled(AUTH)).toBe(true);
    expect(accessMode({ ...AUTH, MBAL_DATA_SOURCE: "oracle", NODE_ENV: "production" })).toBe("auth");
    expect(accessMode({ ...AUTH, MBAL_DATA_SOURCE: "sample" })).toBe("auth");
  });

  it("stays off with a variable missing or blank", () => {
    expect(authEnabled({ ...AUTH, AUTH_SECRET: undefined })).toBe(false);
    expect(authEnabled({ ...AUTH, AUTH_MICROSOFT_ENTRA_ID_TENANT_ID: " " })).toBe(false);
  });

  it("leaves sample mode open, as before", () => {
    expect(accessMode({ NODE_ENV: "production" })).toBe("open");
    expect(accessMode({ MBAL_DATA_SOURCE: "sample", NODE_ENV: "production" })).toBe("open");
  });

  it("locks oracle mode in production and warns in development", () => {
    expect(accessMode({ MBAL_DATA_SOURCE: "oracle", NODE_ENV: "production" })).toBe("locked");
    expect(accessMode({ MBAL_DATA_SOURCE: "oracle", NODE_ENV: "development" })).toBe("dev-warning");
    // A typo is not sample mode: it must never open live data.
    expect(accessMode({ MBAL_DATA_SOURCE: "orcale", NODE_ENV: "production" })).toBe("locked");
  });
});

describe("cronAuthorized", () => {
  const env = { CRON_SECRET: "c0rrect-horse" };

  it("accepts the right bearer token", () => {
    expect(cronAuthorized("Bearer c0rrect-horse", env)).toBe(true);
  });

  it("rejects a missing, wrong or malformed token", () => {
    expect(cronAuthorized(null, env)).toBe(false);
    expect(cronAuthorized("Bearer wrong", env)).toBe(false);
    expect(cronAuthorized("Bearer c0rrect-horse-and-more", env)).toBe(false);
    expect(cronAuthorized("c0rrect-horse", env)).toBe(false);
    expect(cronAuthorized("Basic c0rrect-horse", env)).toBe(false);
  });

  it("rejects everything when no CRON_SECRET is set", () => {
    expect(cronAuthorized("Bearer ", {})).toBe(false);
    expect(cronAuthorized("Bearer anything", {})).toBe(false);
  });
});

describe("isPublicPath and safeCallbackPath", () => {
  it("opens only health, auth and the sign-in pages", () => {
    expect(isPublicPath("/api/health")).toBe(true);
    expect(isPublicPath("/api/auth/callback/microsoft-entra-id")).toBe(true);
    expect(isPublicPath("/sign-in")).toBe(true);
    expect(isPublicPath("/api/finance/journal-lines")).toBe(false);
    expect(isPublicPath("/api/healthz")).toBe(false);
    expect(isPublicPath("/sales")).toBe(false);
  });

  it("only keeps same-site paths as the return address", () => {
    expect(safeCallbackPath("/sales?range=ytd")).toBe("/sales?range=ytd");
    expect(safeCallbackPath("https://evil.example")).toBe("/");
    expect(safeCallbackPath("//evil.example")).toBe("/");
    expect(safeCallbackPath("/\\evil.example")).toBe("/");
    expect(safeCallbackPath(undefined)).toBe("/");
  });
});
