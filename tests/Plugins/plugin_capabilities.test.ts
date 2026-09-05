import { fileURLToPath } from "node:url";
import path from "pathe";
import { describe, expect, it } from "vitest";
import { analyze } from "../../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = (...parts: string[]) =>
  path.join(__dirname, "../fixtures/plugins/capabilities", ...parts);

async function analyzeFixture(name: string, options: Partial<Parameters<typeof analyze>[0]> = {}) {
  return analyze({
    rootDir: fixture(name),
    entry: [],
    includeConventionalEntries: false,
    extensions: [".ts", ".tsx", ".mjs", ".mdx", ".vue", ".html", ".yml", ".yaml"],
    reportUnusedExports: false,
    failOn: "none",
    layers: { skip3: true, skip4: true },
    ...options,
  });
}

function unusedPackages(report: Awaited<ReturnType<typeof analyze>>): string[] {
  return report.findings
    .filter(
      (finding) => finding.rule === "unused-dependency" || finding.rule === "unused-dev-dependency",
    )
    .map((finding) => String(finding.evidence.package));
}

describe("plugin capabilities with real project fixtures", () => {
  it("discovers both Vite MPA HTML entries and protects Vite configuration imports", async () => {
    const report = await analyzeFixture("vite-mpa", {
      entry: ["index.html", "admin/index.html"],
    });
    const unused = unusedPackages(report);
    const discovered = report.summary.filesDiscovered;

    expect(discovered).toBeGreaterThanOrEqual(7);
    expect(unused).not.toEqual(expect.arrayContaining(["vite", "@vitejs/plugin-vue"]));
    expect(
      report.findings.some(
        (finding) =>
          finding.rule === "unused-dev-dependency" && finding.evidence.package === "vite",
      ),
    ).toBe(false);
  });

  it("protects Next app/pages routes, mdx-components, MDX config and @next/mdx", async () => {
    const report = await analyzeFixture("next-components", {
      entry: ["app/page.tsx", "pages/api/health.ts", "next.config.mjs", "mdx-components.tsx"],
    });
    const unused = unusedPackages(report);

    expect(unused).not.toEqual(expect.arrayContaining(["next", "@next/mdx", "react", "react-dom"]));
    expect(report.summary.filesDiscovered).toBeGreaterThanOrEqual(6);
    expect(
      report.findings.some(
        (finding) => finding.rule === "missing-dependency" && finding.evidence.package === "next",
      ),
    ).toBe(false);
  });

  it("marks workflows and actions as used and reports a CLI without setup", async () => {
    const report = await analyzeFixture("github-actions", {
      entry: [".github/workflows/ci.yml"],
    });
    const missingSetup = report.findings.filter((finding) => finding.rule === "missing-ci-setup");

    expect(report.summary.filesDiscovered).toBeGreaterThanOrEqual(1);
    expect(
      missingSetup.some(
        (finding) =>
          finding.file?.endsWith(".github/workflows/ci.yml") &&
          String(finding.evidence.tool).toLowerCase() === "playwright",
      ),
    ).toBe(true);
    expect(
      report.findings.some(
        (finding) =>
          finding.rule === "unused-dev-dependency" && finding.evidence.package === "eslint",
      ),
    ).toBe(false);
  });
});
