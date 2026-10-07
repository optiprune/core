import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyze } from "../../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../fixtures/layers/layer3");
const shadowedCallRootDir = path.resolve(__dirname, "../fixtures/layers/layer3-shadowed-call");
const phiRootDir = path.resolve(__dirname, "../fixtures/layers/layer3-phi");
const edgeCasesRootDir = path.resolve(__dirname, "../fixtures/layers/layer3-edge-cases");

describe("Layer 3: SMT Constraint Solver", () => {
  it("should detect mathematically impossible paths using Z3", async () => {
    const report = await analyze({
      rootDir,
      entry: ["layer-3-test.ts"],
      includeConventionalEntries: false,
    });

    const smtFindings = report.findings.filter((f) => f.rule === "constant-condition");

    // 1. x > 10 && x < 5
    // 2. age < 0 && age > 150
    // (Nested x === 1 and x === 2 might not be caught yet depending on how we track context)
    expect(smtFindings.length).toBeGreaterThanOrEqual(1);

    const impossibleX = smtFindings.find((f) => f.file.includes("layer-3-test.ts"));
    expect(impossibleX).toBeDefined();
    expect(impossibleX?.rule).toBe("constant-condition");

    // The isolated fixture contains at least two contradictory paths; parser
    // backends may report additional nested contradictions.
    expect(smtFindings.length).toBeGreaterThanOrEqual(2);
  });

  it("does not prove mutated or shadowed identifiers unreachable", async () => {
    const report = await analyze({
      rootDir,
      entry: ["layer-3-test.ts"],
      includeConventionalEntries: false,
    });
    const unsoundFindings = report.findings.filter(
      (finding) =>
        finding.rule === "constant-condition" &&
        finding.file.includes("layer-3-test.ts") &&
        (finding.location?.start.line ?? 0) >= 30,
    );
    expect(unsoundFindings).toHaveLength(0);
  });

  it("does not fold a shadowed call using a same-named module function", async () => {
    const report = await analyze({
      rootDir: shadowedCallRootDir,
      entry: ["shadowed-call.ts"],
      includeConventionalEntries: false,
    });
    expect(report.findings.filter((finding) => finding.rule === "constant-condition")).toEqual([]);
  });

  it("tracks assignments through phi joins and proves impossible while bodies", async () => {
    const report = await analyze({
      rootDir: phiRootDir,
      entry: ["phi-loop.ts"],
      includeConventionalEntries: false,
    });
    const findings = report.findings.filter((finding) => finding.rule === "constant-condition");
    expect(findings.some((finding) => finding.evidence.phi === true)).toBe(true);
    expect(findings.some((finding) => finding.evidence.loop === true)).toBe(true);
  });

  it("handles do-while execution, natural loop exits, and unbraced branches", async () => {
    const report = await analyze({
      rootDir: edgeCasesRootDir,
      entry: ["edge-cases.ts"],
      includeConventionalEntries: false,
    });
    const findings = report.findings.filter((finding) => finding.rule === "constant-condition");

    // A normal loop exit must not be reported as an unreachable body, while a
    // contradictory do-while test remains diagnosable after its first run.
    expect(
      findings.some(
        (finding) => finding.evidence.loop === true && finding.evidence.doWhile !== true,
      ),
    ).toBe(false);
    expect(findings.filter((finding) => finding.evidence.doWhile === true)).toHaveLength(1);
    // The body of do-while(false) executes once, so value === 0 is dead.
    // The finding proves that the body was analyzed rather than skipped as an
    // initially-false loop condition.
    expect(findings.some((finding) => finding.evidence.phi === true)).toBe(true);
  });
});
