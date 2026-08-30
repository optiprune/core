import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyze } from "../../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../fixtures/layer3-isolated");

describe("Layer 3: SMT Constraint Solver", () => {
  it("should detect mathematically impossible paths using Z3", async () => {
    const report = await analyze({
      rootDir,
      entry: ["layer3-test.ts"],
      includeConventionalEntries: false,
    });

    const smtFindings = report.findings.filter((f) => f.rule === "constant-condition");

    // 1. x > 10 && x < 5
    // 2. age < 0 && age > 150
    // (Nested x === 1 and x === 2 might not be caught yet depending on how we track context)
    expect(smtFindings.length).toBeGreaterThanOrEqual(1);

    const impossibleX = smtFindings.find((f) => f.file.includes("layer3-test.ts"));
    expect(impossibleX).toBeDefined();
    expect(impossibleX?.rule).toBe("constant-condition");

    // The fixture currently contains two mathematically impossible paths;
    // both must be proven by the SMT layer.
    expect(smtFindings.length).toBeGreaterThanOrEqual(2);
  });
});
