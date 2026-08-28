import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyze } from "../../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

describe("Layer 3: SMT Fixes", () => {
  it("should detect all complex mathematically impossible paths", async () => {
    const report = await analyze({
      rootDir,
      entry: ["tests/fixtures/smt-fix-fixture.ts"],
      includeConventionalEntries: false,
    });

    const smtFindings = report.findings.filter((f) => f.rule === "constant-condition");

    // We expect findings for:
    // 1. a > 20 && a < 5
    // 2. Math.random() > 2
    // 3. Math.random() < -1
    // 4. alwaysFalse()
    // 5. !alwaysTrue()
    // 6. !true
    // 7. !!false
    // 8. obj.prop === 1 && obj.prop === 2
    
    // The current implementation (before fix) likely only finds a few or none of these.
    // Let's see what it finds now.
  });
});
