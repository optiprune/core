import { promises as fs } from "node:fs";
import os from "node:os";
import path from "pathe";
import { afterEach, describe, expect, it } from "vitest";
import { applyFixes } from "../src/fixer.js";
import type { AnalysisReport, Finding } from "../src/types.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

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
      warnings: 0,
    },
    findings,
    modules: [],
    components: [],
  };
}

function finding(rule: Finding["rule"], confidence: Finding["confidence"], file: string, evidence: Record<string, unknown>): Finding {
  return { rule, confidence, severity: "warning", message: rule, file, evidence };
}

async function fixture(packageJson: Record<string, unknown>, source?: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "optiprune-fixer-"));
  temporaryRoots.push(root);
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify(packageJson, null, 2) + "\n");
  if (source !== undefined) await fs.writeFile(path.join(root, "src.ts"), source);
  return root;
}

describe("applyFixes", () => {
  it("removes unused dependencies only when dependencies is selected", async () => {
    const root = await fixture({ dependencies: { used: "1.0.0", unused: "1.0.0" }, devDependencies: { devUnused: "1.0.0" } });
    const findings = report([
      finding("unused-dependency", "high", "package.json", { package: "unused" }),
      finding("unused-dev-dependency", "high", "package.json", { package: "devUnused" }),
    ]);

    expect(await applyFixes(findings, root, { rules: ["dependencies"] })).toBe(1);
    const packageJson = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
    expect(packageJson.dependencies).toEqual({ used: "1.0.0" });
    expect(packageJson.devDependencies).toEqual({ devUnused: "1.0.0" });
  });

  it("removes devDependencies only when devDependencies is selected", async () => {
    const root = await fixture({ devDependencies: { keep: "1.0.0", remove: "1.0.0" } });
    const findings = report([finding("unused-dev-dependency", "high", "package.json", { package: "remove" })]);

    expect(await applyFixes(findings, root, { rules: ["devDependencies"] })).toBe(1);
    const packageJson = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
    expect(packageJson.devDependencies).toEqual({ keep: "1.0.0" });
  });

  it("removes separately declared exports from multiline lists without corrupting syntax", async () => {
    const root = await fixture({}, "const Card = 1;\nconst CardContent = 2;\nexport {\n  Card,\n  CardContent,\n};\n");
    const unusedCard = finding("unused-export", "high", "src.ts", { exportName: "Card" });
    expect(await applyFixes(report([unusedCard]), root, { rules: ["exports"], force: true })).toBe(1);
    const expected = "const Card = 1;\nconst CardContent = 2;\nexport {\n  CardContent,\n};\n";
    expect(await fs.readFile(path.join(root, "src.ts"), "utf8")).toBe(expected);
    expect(await applyFixes(report([unusedCard]), root, { rules: ["exports"], force: true })).toBe(0);
    expect(await fs.readFile(path.join(root, "src.ts"), "utf8")).toBe(expected);
  });

  it("removes an unused exported alias while preserving the local declaration", async () => {
    const root = await fixture({}, "const Card = 1;\nconst CardContent = 2;\nexport { Card as CardAlias, CardContent };\n");
    const unusedAlias = finding("unused-export", "high", "src.ts", { exportName: "CardAlias" });
    expect(await applyFixes(report([unusedAlias]), root, { rules: ["exports"], force: true })).toBe(1);
    expect(await fs.readFile(path.join(root, "src.ts"), "utf8")).toBe("const Card = 1;\nconst CardContent = 2;\nexport { CardContent };\n");
  });

  it("honors confidence thresholds and lets force override them", async () => {
    const root = await fixture({}, "export const value = 1;\n");
    const lowFinding = finding("unused-export", "low", "src.ts", { exportName: "value" });

    expect(await applyFixes(report([lowFinding]), root, { rules: ["exports"], confidence: "high" })).toBe(0);
    expect(await fs.readFile(path.join(root, "src.ts"), "utf8")).toContain("export const");
    expect(await applyFixes(report([lowFinding]), root, { rules: ["exports"], confidence: "high", force: true })).toBe(1);
    expect(await fs.readFile(path.join(root, "src.ts"), "utf8")).toBe("const value = 1;\n");
  });
});
