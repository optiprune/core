import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyze } from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

describe("Layer 2: Control Flow Graph Analysis", () => {
  it("should detect unreachable statements after return and throw", async () => {
    const report = await analyze({
      rootDir,
      entry: ["tests/fixtures/layer2-test.ts"],
      includeConventionalEntries: false,
    });

    const unreachable = report.findings.filter((f) => f.rule === "unreachable-statement");
    
    // 1. after return in unreachableAfterReturn
    // 2. after throw in unreachableAfterThrow
    // 3. exhaustive check in exhaustiveCheck (default branch)
    expect(unreachable.length).toBeGreaterThanOrEqual(2);
    
    const returnUnreachable = unreachable.find(f => f.message.includes("ReturnStatement"));
    expect(returnUnreachable).toBeDefined();
    
    const throwUnreachable = unreachable.find(f => f.message.includes("ThrowStatement"));
    expect(throwUnreachable).toBeDefined();
  });

  it("should detect constant conditions", async () => {
    const report = await analyze({
      rootDir,
      entry: ["tests/fixtures/layer2-test.ts"],
      includeConventionalEntries: false,
    });

    const constantConditions = report.findings.filter((f) => f.rule === "constant-condition");
    
    // Expected findings:
    // From Layer 2 (Syntax-based):
    // 1. if (false)
    // 2. else branch of if (true)
    // 3. while (false)
    // From Layer 3 (SMT-based):
    // 4. if (false) -> UNSAT then
    // 5. if (true) -> UNSAT else
    // 6. x === 1 && x === 2 -> SMT might also flag this if implemented
    
    expect(constantConditions.length).toBeGreaterThanOrEqual(3);
  });

  it("should detect contradictory guards", async () => {
    const report = await analyze({
      rootDir,
      entry: ["tests/fixtures/layer2-test.ts"],
      includeConventionalEntries: false,
    });

    const contradictory = report.findings.filter((f) => f.rule === "contradictory-guard");
    expect(contradictory.length).toBe(1);
    expect(contradictory[0].message).toContain("contradiction");
  });

  it("should detect type narrowing exhaustion (assertNever)", async () => {
    const report = await analyze({
      rootDir,
      entry: ["tests/fixtures/layer2-test.ts"],
      includeConventionalEntries: false,
    });

    const exhaustive = report.findings.find(f => f.evidence.type === "exhaustive-check");
    expect(exhaustive).toBeDefined();
    expect(exhaustive?.rule).toBe("unreachable-statement");
  });
});
