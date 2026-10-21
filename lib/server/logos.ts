import "server-only";

import { readdirSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Company logos, dropped by hand into `public/logos/` as `<company code>.svg` or `.png` (see the
 * README). None ship with the app. The folder is listed again only when its modification time
 * changes (adding or removing a file does that), so a new logo shows without a restart. Listing it on
 * every request made `next dev` on Windows see a change and reload the page in a loop. A missing
 * folder means no logos, and the sidebar shows a monogram instead.
 */

export const LOGO_DIR = path.join(process.cwd(), "public", "logos");
const LOGO_RE = /^([\w.-]{1,30})\.(svg|png)$/i;

let listed: { dir: string; mtimeMs: number; logos: Record<string, string> } | undefined;

/** Company code → logo URL. An `.svg` wins over a `.png` of the same code. */
export function companyLogos(dir: string = LOGO_DIR): Record<string, string> {
  let mtimeMs: number;
  try {
    mtimeMs = statSync(dir).mtimeMs;
  } catch {
    return {};
  }
  if (listed?.dir === dir && listed.mtimeMs === mtimeMs) return listed.logos;
  const logos = listLogos(dir);
  listed = { dir, mtimeMs, logos };
  return logos;
}

function listLogos(dir: string): Record<string, string> {
  let files: string[];
  try {
    files = readdirSync(dir);
  } catch {
    return {};
  }
  const logos: Record<string, string> = {};
  for (const file of files.sort()) {
    const match = LOGO_RE.exec(file);
    if (!match) continue;
    const [, code, extension] = match;
    if (logos[code]?.endsWith(".svg") && extension.toLowerCase() !== "svg") continue;
    logos[code] = `/logos/${encodeURIComponent(file)}`;
  }
  return logos;
}
