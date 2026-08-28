import { describe, it, expect } from "vitest";
import { analyze } from "../../src/index.js";
import path from "node:path";

describe("Next.js App Router Validation", () => {
  it("should correctly identify entry points and unused components", async () => {
    const rootDir = path.resolve(__dirname, "../test-repos/nextjs-app");
    const patterns = ["app/**/page.tsx", "app/**/layout.tsx", "app/api/**/route.ts"];
    
    const report = await analyze({
      rootDir,
      entry: patterns,
      includeConventionalEntries: false,
    });

    const unused = report.findings.filter(f => f.rule === "unused-export");
const isUnusedFound = report.findings.some(f => (f.rule === "unreachable-file" || f.rule === "unused-export") && f.file.includes("UnusedComponent.tsx"));
    const isButtonFound = report.findings.some(f => f.rule === "unused-export" && f.file.includes("Button.tsx"));
    
    expect(isUnusedFound).toBe(true);
    expect(isButtonFound).toBe(false);
  });
});
