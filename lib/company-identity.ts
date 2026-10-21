/** Words that say what kind of company it is, left out of the monogram ("Alpha Trading LLC" → "AT"). */
const LEGAL_WORDS = new Set([
  "llc",
  "l.l.c",
  "l.l.c.",
  "fze",
  "fzco",
  "fzc",
  "fz",
  "co",
  "co.",
  "ltd",
  "ltd.",
  "est",
  "est.",
  "&",
  "and",
  "the",
]);

/** Up to two initials for a company's monogram badge. */
export function monogram(name: string): string {
  const words = name
    .split(/[\s\-/]+/)
    .filter((word) => word && !LEGAL_WORDS.has(word.toLowerCase()) && /[\p{L}\p{N}]/u.test(word));
  const letters = words.slice(0, 2).map((word) => [...word.replace(/[^\p{L}\p{N}]/gu, "")][0] ?? "");
  return letters.join("").toUpperCase() || "?";
}
