import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "pathe";
import { DEFAULT_CONFIG, mergeConfig } from "../../src/config-loader.js";
import { getAnalysisCacheSignature, parseCacheContent, saveCache } from "../../src/cache.js";
import { parseModulesInWorkers } from "../../src/parse-workers.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

describe("experimental performance and cache contracts", () => {
  it("normalizes and clamps the configurable parser worker limit", () => {
    expect(mergeConfig(DEFAULT_CONFIG, { maxWorkers: 7 }).maxWorkers).toBe(7);
    expect(mergeConfig(DEFAULT_CONFIG, { maxWorkers: 2.9 }).maxWorkers).toBe(2);
    expect(mergeConfig(DEFAULT_CONFIG, { maxWorkers: -3 }).maxWorkers).toBe(0);
  });

  it("keeps worker fallback semantics when the configured pool is disabled", async () => {
    const result = await parseModulesInWorkers(
      [{ file: "/virtual/index.ts", sourceText: "export const value = 1;" }],
      0,
    );
    expect(result.get("/virtual/index.ts")?.parseStatus).toBe("parsed");
  });

  it("changes the cache signature when analysis semantics change", () => {
    const base = {
      extensions: [".ts"],
      ignore: ["dist/**"],
      ignoreTests: false,
      ignoreUnknownImport: false,
      production: false,
      entry: ["src/index.ts"],
      plugins: { vite: true },
    } as const;
    const first = getAnalysisCacheSignature(base, { vite: "1" });
    expect(getAnalysisCacheSignature(base, { vite: "2" })).not.toBe(first);
    expect(getAnalysisCacheSignature({ ...base, production: true }, { vite: "1" })).not.toBe(first);
  });

  it("preserves compatible cache signatures and writes a complete envelope", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "optiprune-cache-contract-"));
    temporaryRoots.push(root);
    const signature = getAnalysisCacheSignature(
      {
        extensions: [".ts"],
        ignore: [],
        ignoreTests: false,
        ignoreUnknownImport: false,
        production: false,
        entry: [],
        plugins: {},
      },
      {},
    );
    saveCache(root, { version: "3.0", signature, entries: {} });
    const raw = await fs.readFile(path.join(root, ".optiprune", "cache.json"), "utf8");
    expect(parseCacheContent(raw).signature).toBe(signature);
    expect(raw).not.toContain(".tmp");
  });
});
