import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyze } from "../../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("TypeScript Local Reference Tracking (Fix 3)", () => {
  it("should not flag interfaces used as type annotations in the same file as unused", async () => {
    const rootDir = path.join(__dirname, "..", "fixtures", "ts-local-ref-test");
    const report = await analyze({
      rootDir,
      entry: ["entry.ts"],
      extensions: [".ts"],
      ignore: [],
      reportUnusedExports: true,
      includeConventionalEntries: false,
    });

    // 1. foo should be used
    const fooUnused = report.findings.find(
      (f) => f.file.includes("lib.ts") && f.evidence.exportName === "foo",
    );
    expect(fooUnused).toBeUndefined();

    // 2. MyInterface should NOT be unused because it's referenced by foo
    const myInterfaceUnused = report.findings.find(
      (f) => f.file.includes("lib.ts") && f.evidence.exportName === "MyInterface",
    );
    expect(
      myInterfaceUnused,
      "MyInterface should be marked as used because it is referenced in foo's type annotation",
    ).toBeUndefined();

    // 3. UnusedInterface SHOULD be unused
    const unusedInterfaceFinding = report.findings.find(
      (f) => f.file.includes("lib.ts") && f.evidence.exportName === "UnusedInterface",
    );
    expect(unusedInterfaceFinding).toBeDefined();
    expect(unusedInterfaceFinding?.rule).toBe("unused-export");

    // 4. Member usage in the defining module should be tracked precisely.
    const usedMemberFinding = report.findings.find(
      (finding) =>
        finding.rule === "unused-member" &&
        finding.evidence.exportName === "PartiallyUsedInterface" &&
        finding.evidence.memberName === "used",
    );
    expect(usedMemberFinding).toBeUndefined();

    const unusedMemberFinding = report.findings.find(
      (finding) =>
        finding.rule === "unused-member" &&
        finding.evidence.exportName === "PartiallyUsedInterface" &&
        finding.evidence.memberName === "unused",
    );
    expect(unusedMemberFinding).toBeDefined();
  });
});
