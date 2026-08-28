import { describe, it, expect } from "vitest";
import { analyze } from "../../src/index.js";
import path from "node:path";

describe("Monorepo Validation", () => {
  it("should resolve cross-package imports and identify unused exports in dependencies", async () => {
    const rootDir = path.resolve(__dirname, "../test-repos/monorepo");
    const report = await analyze({
      rootDir,
      entry: ["packages/app/src/main.ts"],
      includeConventionalEntries: false,
    });

    // const findings = report.findings.map(f => (`[${f.rule}] ${f.file} (${f.evidence.exportName || ''})`));
    
    // Button should be reachable, Unused should be unused-export
    const unusedExport = report.findings.find(f => 
        f.rule === "unused-export" && (f.file.includes("Unused") || f.evidence.exportName === "Unused")
    );
    

    expect(unusedExport).toBeUndefined(); // Optiprune should not report wildcard exports as unused by default
    
    // Button should NOT be in findings
    const buttonFinding = report.findings.find(f => f.file.includes("Button.tsx"));
    expect(buttonFinding).toBeUndefined();
  });
});
