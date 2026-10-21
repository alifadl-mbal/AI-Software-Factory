import { AGING_BUCKETS } from "./aging";

/**
 * The aging drill-down lives in the URL, so a reload or a shared link reopens it:
 *
 *   ?aging=ar-3              a column of the AR (or `ap-…`) aging chart, by ladder index: its accounts
 *   &agingAccount=C0001      the open account: a customer code, or `company|vendor` for AP
 *
 * Safe to import on the client and the server.
 */

export const AGING_PARAM = "aging";
export const AGING_ACCOUNT_PARAM = "agingAccount";

export type AgingSide = "ar" | "ap";

const AGING_RE = /^(ar|ap)-(\d)$/;
const BUCKET_RE = /^\d$/;
const ACCOUNT_RE = /^[\w.\- |]{1,60}$/;

export function agingParam(side: AgingSide, bucket: number): string {
  return `${side}-${bucket}`;
}

/** A ladder index (0 = `<30 D` … 6 = `2+ Y`) from a URL parameter, or `null`. */
export function parseBucket(value: string | null | undefined): number | null {
  if (!value || !BUCKET_RE.test(value)) return null;
  const bucket = Number(value);
  return bucket < AGING_BUCKETS.length ? bucket : null;
}

/** `ar-3` → `{ side: "ar", bucket: 3 }`; `null` if malformed. */
export function parseAgingParam(
  value: string | null | undefined,
): { side: AgingSide; bucket: number } | null {
  const match = value ? AGING_RE.exec(value) : null;
  const bucket = match ? parseBucket(match[2]) : null;
  return match && bucket !== null ? { side: match[1] as AgingSide, bucket } : null;
}

export function parseAgingAccount(value: string | null | undefined): string | null {
  return value && ACCOUNT_RE.test(value) ? value : null;
}

export function parseSide(value: string | null | undefined): AgingSide | null {
  return value === "ar" || value === "ap" ? value : null;
}
