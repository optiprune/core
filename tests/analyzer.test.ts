import { describe, it, expect } from "vitest";
import { analyze, shouldFail } from "../src/index.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(__dirname, "fixtures");

describe("Optiprune Analyzer", () => {
  it("should handle circular dependencies and report unused exports within a cycle", async () => {
    const circularDepsDir = path.join(fixturesDir, "circular-deps");
    const report = await analyze({
      rootDir: circularDepsDir,
      entry: ["circular-a.ts"],
      extensions: [".ts"],
      ignore: [],
      reportUnusedExports: true,
    });

    expect(report.summary.filesDiscovered).toBe(2);
    expect(report.summary.filesParsed).toBe(2);
    expect(report.summary.cycles).toBe(1);
    expect(report.findings.length).toBe(2); // unusedA, unusedB

    const unreachableFileFinding = report.findings.find((f) => f.rule === "unreachable-file");
    expect(unreachableFileFinding).toBeUndefined(); // Both files are reachable from each other

    const unusedA = report.findings.find((f) => f.rule === "unused-export" && f.evidence.exportName === "unusedA");
    expect(unusedA).toBeDefined();
    expect(unusedA?.confidence).toBe("high");

    const unusedB = report.findings.find((f) => f.rule === "unused-export" && f.evidence.exportName === "unusedB");
    expect(unusedB).toBeDefined();
    expect(unusedB?.confidence).toBe("high");
    expect(shouldFail(report, "none")).toBe(false);
    expect(shouldFail(report, "high")).toBe(true);
  });

  it("should handle invalid syntax gracefully with fallback parsing", async () => {
    const invalidSyntaxDir = path.join(fixturesDir, "invalid-syntax-test");
    const report = await analyze({
      rootDir: invalidSyntaxDir,
      entry: ["invalid-syntax.ts"],
      extensions: [".ts"],
      ignore: [],
      reportUnusedExports: true,
    });

    expect(report.summary.filesDiscovered).toBe(2);
    expect(report.summary.filesFallback).toBe(1);
    // The primary goal is to ensure parse recovery is reported.
    // The exact number of other findings (like unused-export) can vary based on fallback parsing.
    expect(report.findings.length).toBeGreaterThanOrEqual(1);

    const parseError = report.findings.find((f) => f.rule === "parse-recovery");
    expect(parseError).toBeDefined();
    expect(parseError?.severity).toBe("error"); // Expecting an error for unrecoverable syntax
    expect(parseError?.message).toContain("Parse failed");

    const validExport = report.findings.find((f) => f.rule === "unused-export" && f.evidence.exportName === "validExport");
    expect(validExport).toBeDefined(); // Fallback parsing should detect this unused export.
    expect(validExport?.confidence).toBe("high");
  });

  it("should report unreachable files", async () => {
    const unreachableDir = path.join(fixturesDir, "unreachable-test");
    // Create a dummy file that is not an entry point
    await fs.promises.mkdir(unreachableDir, { recursive: true });
    await fs.promises.writeFile(path.join(unreachableDir, "unreachable.ts"), "export const x = 1;");

    const report = await analyze({
      rootDir: unreachableDir,
      entry: [], // No entry points, so all files should be unreachable
      extensions: [".ts"],
      ignore: [],
      reportUnusedExports: false,
      includeConventionalEntries: false,
    });


    expect(report).toBeDefined();
    expect(report.summary).toBeDefined();
    expect(report.summary.filesDiscovered).toBe(1);
    expect(report.summary.findings).toBeDefined();
    expect(report.findings.length).toBe(2); // Expecting one unreachable-file and one no-entry-points finding

    const unreachableFileFinding = report.findings.find((f) => f.rule === "unreachable-file");
    expect(unreachableFileFinding).toBeDefined();
    expect(unreachableFileFinding?.confidence).toBe("high");
    expect(unreachableFileFinding?.file).toContain("unreachable.ts");

    const noEntryPointsFinding = report.findings.find((f) => f.rule === "no-entry-points");
    expect(noEntryPointsFinding).toBeDefined();
    expect(noEntryPointsFinding?.confidence).toBe("info");
  });
});
