import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyze } from "../src/index.js";
import { loadCache } from "../src/cache.js";
import { findingDiagnostic, findingRange, findingSeverity } from "../src/language-server-utils.js";
import type { Finding } from "../src/types.js";

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    rule: "unused-export",
    severity: "warning",
    confidence: "high",
    message: "Unused export",
    file: "src/index.ts",
    evidence: {},
    ...overrides,
  };
}

describe("OptiPrune language server", () => {
  it("maps one-based Core ranges to zero-based LSP ranges", () => {
    const range = findingRange(makeFinding({
      location: {
        start: { line: 4, column: 7 },
        end: { line: 4, column: 18 },
      },
    }));
    expect(range).toEqual({
      start: { line: 3, character: 6 },
      end: { line: 3, character: 17 },
    });
  });

  it("uses a safe one-character range when Core has no location", () => {
    expect(findingRange(makeFinding())).toEqual({
      start: { line: 0, character: 0 },
      end: { line: 0, character: 1 },
    });
  });

  it("maps severities and preserves rule and confidence in diagnostics", () => {
    expect(findingSeverity("error")).toBe(1);
    expect(findingSeverity("warning")).toBe(2);
    expect(findingSeverity("info")).toBe(3);
    expect(findingDiagnostic(makeFinding({ rule: "unreachable-file", confidence: "medium" }))).toMatchObject({
      source: "optiprune",
      code: "unreachable-file",
      message: expect.stringContaining("confidence: medium"),
    });
  });

  it("writes complete per-file findings and returns the stored report on an unchanged run", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "optiprune-lsp-cache-"));
    try {
      await writeFile(join(rootDir, "package.json"), JSON.stringify({ name: "cache-fixture", private: true }));
      await writeFile(join(rootDir, "src.ts"), "export const used = 1;\n", "utf8");
      const options = { rootDir, entry: ["src.ts"], output: "json" as const, reportUnusedExports: true };

      const first = await analyze(options);
      const cacheAfterFirst = loadCache(rootDir);
      expect(cacheAfterFirst.report).toBeDefined();
      expect(cacheAfterFirst.fileStats?.[join(rootDir, "src.ts")]).toBeDefined();
      expect(Array.isArray(cacheAfterFirst.entries[join(rootDir, "src.ts")]?.findings)).toBe(true);
      const cacheText = await readFile(join(rootDir, ".optiprune/cache.json"), "utf8");

      const second = await analyze(options);
      const cacheTextAfterSecond = await readFile(join(rootDir, ".optiprune/cache.json"), "utf8");
      expect(second).toEqual(first);
      expect(cacheTextAfterSecond).toBe(cacheText);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("invalidates the report when a source file changes and persists the new hash", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "optiprune-lsp-invalidate-"));
    try {
      await writeFile(join(rootDir, "package.json"), JSON.stringify({ name: "invalidate-fixture", private: true }));
      const sourcePath = join(rootDir, "src.ts");
      await writeFile(sourcePath, "export const value = 1;\n", "utf8");
      const options = { rootDir, entry: ["src.ts"], output: "json" as const, reportUnusedExports: true };
      await analyze(options);
      const before = loadCache(rootDir).fileHashes?.[sourcePath];
      await writeFile(sourcePath, "export const value = 2;\n", "utf8");
      const now = new Date(Date.now() + 2000);
      await utimes(sourcePath, now, now);
      const changed = await analyze(options);
      const afterCache = loadCache(rootDir);
      expect(afterCache.fileHashes?.[sourcePath]).not.toBe(before);
      expect(afterCache.report).toEqual(changed);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});
