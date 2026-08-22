import fs from "node:fs/promises";
import os from "node:os";
import path from "pathe";
import { afterEach, describe, expect, it } from "vitest";
import { analyze } from "../src/index.js";
import { applyFixes } from "../src/fixer.js";
import { parseModule } from "../src/parser.js";
import { parseJsonDocument, repairJsonDocument } from "../src/json-utils.js";
import type { AnalysisReport, Finding } from "../src/types.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function rootWith(files: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "optiprune-json-recovery-"));
  roots.push(root);
  for (const [file, content] of Object.entries(files)) {
    const target = path.join(root, file);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, "utf8");
  }
  return root;
}

function report(findings: Finding[]): AnalysisReport {
  return {
    version: "test",
    rootDir: "/tmp",
    entryPoints: [],
    summary: {
      filesDiscovered: 0,
      filesParsed: 0,
      filesRecovered: 0,
      filesFallback: 0,
      edges: 0,
      entryPoints: 0,
      stronglyConnectedComponents: 0,
      cycles: 0,
      findings: findings.length,
      errors: 0,
      warnings: findings.length,
    },
    findings,
    modules: [],
    components: [],
  };
}

function jsonParseFinding(repairable: boolean): Finding {
  return {
    rule: "parse-recovery",
    severity: repairable ? "warning" : "error",
    confidence: "high",
    message: "Invalid package.json",
    file: "package.json",
    evidence: { kind: "json-parse", repairable },
  };
}

describe("structured JSON diagnostics", () => {
  it("reports the exact reason and location for a missing comma without using regex recovery", () => {
    const source = '{\n  "name": "demo"\n  "version": "1.0.0"\n}\n';
    const parsed = parseJsonDocument<Record<string, string>>(source);

    expect(parsed.valid).toBe(false);
    expect(parsed.recovered).toBe(true);
    expect(parsed.repairable).toBe(true);
    expect(parsed.value).toEqual({ name: "demo", version: "1.0.0" });
    expect(parsed.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "CommaExpected",
        location: { start: { line: 3, column: 3 }, end: expect.any(Object) },
        message: expect.stringContaining("Expected ','"),
        excerpt: '  "version": "1.0.0"',
      }),
    ]));
  });

  it("does not expose an unsafe partially parsed package manifest", () => {
    const source = '{ name: "demo" }\n';
    const parsed = parseJsonDocument<Record<string, string>>(source);

    expect(parsed.valid).toBe(false);
    expect(parsed.recovered).toBe(false);
    expect(parsed.repairable).toBe(false);
    expect(parsed.value).toBeUndefined();
    expect(parsed.diagnostics[0]).toMatchObject({
      code: "InvalidSymbol",
      location: { start: { line: 1, column: 3 } },
    });
    expect(repairJsonDocument(source)).toBeUndefined();
  });

  it("repairs comments, trailing commas, and a missing comma into canonical strict JSON", () => {
    const extensions = '{\n  // package display name\n  "name": "demo",\n}\n';
    const missingComma = '{\n  "name": "demo"\n  "version": "1.0.0"\n}\n';

    const repairedExtensions = repairJsonDocument(extensions);
    const repairedMissingComma = repairJsonDocument(missingComma);

    expect(repairedExtensions).toBeDefined();
    expect(repairedMissingComma).toBeDefined();
    expect(JSON.parse(repairedExtensions!)).toEqual({ name: "demo" });
    expect(JSON.parse(repairedMissingComma!)).toEqual({ name: "demo", version: "1.0.0" });
  });
});

describe("package.json report and fixer integration", () => {
  it("emits machine-readable package.json diagnostics and verbose JSON debug data", async () => {
    const root = await rootWith({
      "package.json": '{\n  "name": "demo"\n  "main": "src/index.ts"\n}\n',
      "src/index.ts": "export const value = 1;\n",
    });

    const result = await analyze({
      rootDir: root,
      output: "json",
      verbose: true,
      skip3: true,
      skip4: true,
    });

    const parseFinding = result.findings.find((finding) => finding.file === "package.json" && finding.rule === "parse-recovery");
    expect(parseFinding).toMatchObject({
      severity: "warning",
      location: { start: { line: 3, column: 3 } },
      evidence: { kind: "json-parse", code: "CommaExpected", repairable: true },
    });
    expect(result.debug?.json.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        file: "package.json",
        code: "CommaExpected",
        recovered: true,
        repairable: true,
      }),
    ]));
    expect(result.debug?.parser.modulesByStatus.parsed).toBeGreaterThanOrEqual(1);
  });

  it("repairs a safe malformed package.json and removes a reported unused devDependency in one fix pass", async () => {
    const root = await rootWith({
      "package.json": '{\n  "devDependencies": {\n    "keep": "1.0.0"\n    "remove": "1.0.0"\n  }\n}\n',
    });
    const unusedDevDependency: Finding = {
      rule: "unused-dev-dependency",
      severity: "warning",
      confidence: "high",
      message: "unused dev dependency",
      file: "package.json",
      evidence: { package: "remove" },
    };

    expect(await applyFixes(report([jsonParseFinding(true), unusedDevDependency]), root, true)).toBe(2);
    const packageJson = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
    expect(packageJson.devDependencies).toEqual({ keep: "1.0.0" });
  });

  it("does not rewrite an unsafe package.json even when a parse-recovery finding is passed to the fixer", async () => {
    const root = await rootWith({ "package.json": '{ name: "demo" }\n' });

    expect(await applyFixes(report([jsonParseFinding(false)]), root, true)).toBe(0);
    expect(await fs.readFile(path.join(root, "package.json"), "utf8")).toBe('{ name: "demo" }\n');
  });
});

describe("source parser diagnostics", () => {
  it("retains the parser reason, location, and source excerpt when fallback analysis is required", () => {
    const module = parseModule("export const = 1;\n", "broken.ts");
    const diagnostic = module.parseDiagnostics[0];

    expect(module.parseStatus).toBe("fallback");
    expect(diagnostic).toMatchObject({
      code: "YukuParserError",
      recovered: false,
      location: expect.any(Object),
      excerpt: "export const = 1;",
    });
    expect(diagnostic?.message.length).toBeGreaterThan(0);
  });
});
