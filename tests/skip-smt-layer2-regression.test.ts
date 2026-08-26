import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyze } from "../src/index.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("skip smt Layer 2 regression", () => {
  it("does not inspect impossible conditions but still runs ordinary Layer 2 CFG checks", async () => {
    const result = await analyze({
      rootDir,
      entry: ["tests/fixtures/layer2-test.ts"],
      includeConventionalEntries: false,
      skipSmt: true,
      skip4: true,
    });

    expect(result.findings.some((finding) => finding.rule === "constant-condition")).toBe(false);
    expect(result.findings.some((finding) => finding.rule === "contradictory-guard")).toBe(false);
    expect(result.findings.some((finding) => finding.rule === "unreachable-statement")).toBe(true);
  });
});
