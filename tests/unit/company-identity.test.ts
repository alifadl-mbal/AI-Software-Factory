import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { monogram } from "@/lib/company-identity";
import { companyLogos } from "@/lib/server/logos";

describe("monogram", () => {
  it("takes the first two words, leaving out legal forms", () => {
    expect(monogram("Alpha Trading LLC")).toBe("AT");
    expect(monogram("Placeholder Foods FZE")).toBe("PF");
    expect(monogram("beta")).toBe("B");
    expect(monogram("The (Gulf) & Co.")).toBe("G");
    expect(monogram("  ")).toBe("?");
  });
});

describe("companyLogos", () => {
  it("maps company codes to svg or png files, svg first", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "logos-"));
    for (const file of ["101.png", "101.svg", "107.png", "notes.txt", "bad name.svg"]) {
      writeFileSync(path.join(dir, file), "");
    }
    expect(companyLogos(dir)).toEqual({ "101": "/logos/101.svg", "107": "/logos/107.png" });
  });

  it("no folder means no logos", () => {
    expect(companyLogos(path.join(tmpdir(), "no-such-logo-dir-xyz"))).toEqual({});
  });
});
