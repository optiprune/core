import { promises as fs } from "node:fs";
import path from "pathe";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { analyze } from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot = path.join(__dirname, "fixtures", "package-script-entry-points");

afterEach(async () => {
  await fs.rm(fixtureRoot, { recursive: true, force: true });
});

describe("package script entry points", () => {
  it("treats concrete Node script paths and package binaries as reachable roots", async () => {
    await fs.mkdir(path.join(fixtureRoot, "scripts"), { recursive: true });
    await fs.mkdir(path.join(fixtureRoot, "bin"), { recursive: true });
    await fs.mkdir(path.join(fixtureRoot, "src"), { recursive: true });
    await fs.writeFile(path.join(fixtureRoot, "package.json"), JSON.stringify({
      name: "package-script-entry-points",
      private: true,
      type: "module",
      bin: { fixture: "./bin/fixture.mjs" },
      scripts: {
        build: "node --enable-source-maps scripts/prepare.mjs && node -r ./scripts/register.cjs scripts/after.mjs",
        inline: "node --eval \"console.log('inline command')\""
      }
    }, null, 2));
    await fs.writeFile(path.join(fixtureRoot, "bin", "fixture.mjs"), "console.log('bin');\n");
    await fs.writeFile(path.join(fixtureRoot, "scripts", "prepare.mjs"), "console.log('prepare');\n");
    await fs.writeFile(path.join(fixtureRoot, "scripts", "register.cjs"), "module.exports = {};\n");
    await fs.writeFile(path.join(fixtureRoot, "scripts", "after.mjs"), "console.log('after');\n");
    await fs.writeFile(path.join(fixtureRoot, "src", "orphan.ts"), "export const orphan = true;\n");

    const report = await analyze({
      rootDir: fixtureRoot,
      entry: [],
      extensions: [".ts", ".mjs", ".cjs"],
      includeConventionalEntries: false,
      reportUnusedExports: false,
    });

    expect(report.entryPoints).toEqual(expect.arrayContaining([
      "bin/fixture.mjs",
      "scripts/prepare.mjs",
      "scripts/after.mjs",
    ]));
    expect(report.findings.some((finding) => finding.rule === "unreachable-file" && finding.file.endsWith("bin/fixture.mjs"))).toBe(false);
    expect(report.findings.some((finding) => finding.rule === "unreachable-file" && finding.file.endsWith("scripts/prepare.mjs"))).toBe(false);
    expect(report.findings.some((finding) => finding.rule === "unreachable-file" && finding.file.endsWith("scripts/after.mjs"))).toBe(false);
    expect(report.findings.some((finding) => finding.rule === "unreachable-file" && finding.file.endsWith("src/orphan.ts"))).toBe(true);
    expect(report.findings.some((finding) => finding.rule === "missing-script-target")).toBe(false);
  });

  it("treats Bun file arguments as reachable roots without treating Bun subcommands as files", async () => {
    await fs.mkdir(path.join(fixtureRoot, "perf"), { recursive: true });
    await fs.mkdir(path.join(fixtureRoot, "test", "integration"), { recursive: true });
    await fs.writeFile(path.join(fixtureRoot, "package.json"), JSON.stringify({
      name: "bun-package-script-entry-points",
      private: true,
      scripts: {
        perf: "bun perf/bench.ts",
        "test:integration:release": "bun test/integration/release.ts",
        check: "bun run perf/bench.ts",
        unit: "bun test",
      },
    }, null, 2));
    await fs.writeFile(path.join(fixtureRoot, "perf", "bench.ts"), "export const bench = true;\n");
    await fs.writeFile(path.join(fixtureRoot, "test", "integration", "release.ts"), "export const release = true;\n");

    const report = await analyze({
      rootDir: fixtureRoot,
      entry: [],
      extensions: [".ts"],
      includeConventionalEntries: false,
      reportUnusedExports: false,
    });

    expect(report.entryPoints).toEqual(expect.arrayContaining([
      "perf/bench.ts",
      "test/integration/release.ts",
    ]));
    expect(report.findings.some((finding) => finding.rule === "missing-script-target")).toBe(false);
  });

  it("counts Vite as used when Vitest configuration is the only evidence", async () => {
    await fs.mkdir(fixtureRoot, { recursive: true });
    await fs.writeFile(path.join(fixtureRoot, "package.json"), JSON.stringify({
      name: "vitest-vite-usage",
      private: true,
      devDependencies: { vitest: "3.0.0", vite: "6.0.0" },
    }, null, 2));
    await fs.writeFile(path.join(fixtureRoot, "vitest.config.ts"), "export default { test: { environment: 'node' } };\n");

    const report = await analyze({
      rootDir: fixtureRoot,
      entry: [],
      extensions: [".ts"],
      includeConventionalEntries: false,
      reportUnusedExports: false,
    });

    expect(report.findings.some((finding) => finding.evidence?.package === "vite")).toBe(false);
    expect(report.findings.some((finding) => finding.evidence?.package === "vitest")).toBe(false);
  });

  it("reports a high-confidence error when a concrete local Node script target is absent", async () => {
    await fs.mkdir(fixtureRoot, { recursive: true });
    await fs.writeFile(path.join(fixtureRoot, "package.json"), JSON.stringify({
      name: "missing-package-script-target",
      private: true,
      scripts: { verify: "node ./scripts/does-not-exist.mjs" }
    }, null, 2));

    const report = await analyze({
      rootDir: fixtureRoot,
      entry: [],
      extensions: [".mjs"],
      includeConventionalEntries: false,
      reportUnusedExports: false,
    });

    const diagnostic = report.findings.find((finding) => finding.rule === "missing-script-target");
    expect(diagnostic).toMatchObject({
      severity: "error",
      confidence: "high",
      file: path.join(fixtureRoot, "package.json"),
      evidence: {
        script: "verify",
        targetPath: "scripts/does-not-exist.mjs"
      }
    });
  });
});
