import { promises as fs } from "node:fs";
import path from "pathe";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { analyze } from "../../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot = path.join(__dirname, "..", "fixtures", "package-script-entry-points");

afterEach(async () => {
  await fs.rm(fixtureRoot, { recursive: true, force: true });
});

describe("package script entry points", () => {
  it("treats concrete Node script paths and package binaries as reachable roots", async () => {
    await fs.mkdir(path.join(fixtureRoot, "scripts"), { recursive: true });
    await fs.mkdir(path.join(fixtureRoot, "bin"), { recursive: true });
    await fs.mkdir(path.join(fixtureRoot, "src"), { recursive: true });
    await fs.writeFile(
      path.join(fixtureRoot, "package.json"),
      JSON.stringify(
        {
          name: "package-script-entry-points",
          private: true,
          type: "module",
          bin: { fixture: "./bin/fixture.mjs" },
          scripts: {
            build:
              "node --enable-source-maps scripts/prepare.mjs && node -r ./scripts/register.cjs scripts/after.mjs",
            inline: "node --eval \"console.log('inline command')\"",
          },
        },
        null,
        2,
      ),
    );
    await fs.writeFile(path.join(fixtureRoot, "bin", "fixture.mjs"), "console.log('bin');\n");
    await fs.writeFile(
      path.join(fixtureRoot, "scripts", "prepare.mjs"),
      "console.log('prepare');\n",
    );
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

    expect(report.entryPoints).toEqual(
      expect.arrayContaining(["bin/fixture.mjs", "scripts/prepare.mjs", "scripts/after.mjs"]),
    );
    expect(
      report.findings.some(
        (finding) =>
          finding.rule === "unreachable-file" && finding.file.endsWith("bin/fixture.mjs"),
      ),
    ).toBe(false);
    expect(
      report.findings.some(
        (finding) =>
          finding.rule === "unreachable-file" && finding.file.endsWith("scripts/prepare.mjs"),
      ),
    ).toBe(false);
    expect(
      report.findings.some(
        (finding) =>
          finding.rule === "unreachable-file" && finding.file.endsWith("scripts/after.mjs"),
      ),
    ).toBe(false);
    expect(
      report.findings.some(
        (finding) => finding.rule === "unreachable-file" && finding.file.endsWith("src/orphan.ts"),
      ),
    ).toBe(true);
    expect(report.findings.some((finding) => finding.rule === "missing-script-target")).toBe(false);
  });

  it("retains files bundled by a script and accepts workspace-owned root tooling dependencies", async () => {
    await fs.mkdir(path.join(fixtureRoot, "scripts"), { recursive: true });
    await fs.mkdir(path.join(fixtureRoot, "packages", "core"), { recursive: true });
    await fs.mkdir(path.join(fixtureRoot, "src"), { recursive: true });
    await fs.writeFile(
      path.join(fixtureRoot, "package.json"),
      JSON.stringify(
        {
          name: "script-bundled-monorepo",
          private: true,
          workspaces: ["packages/*"],
          type: "module",
          scripts: {
            check: "node scripts/run.mjs",
            metadata: "node scripts/metadata.mjs",
          },
          devDependencies: { "@webcontainer/api": "1.0.0" },
        },
        null,
        2,
      ),
    );
    await fs.writeFile(
      path.join(fixtureRoot, "packages", "core", "package.json"),
      JSON.stringify({ name: "@fixture/core", devDependencies: { esbuild: "1.0.0" } }),
    );
    await fs.writeFile(
      path.join(fixtureRoot, "scripts", "run.mjs"),
      'import { build } from "esbuild";\nconst options = { entryPoints: { "bundle.min.js": `client.js?worker` } };\nbuild(options);\n',
    );
    await fs.writeFile(
      path.join(fixtureRoot, "scripts", "metadata.mjs"),
      'const metadata = { entryPoints: ["false-positive.js"] };\nvoid metadata;\n',
    );
    await fs.writeFile(path.join(fixtureRoot, "scripts", "false-positive.js"), "");
    await fs.writeFile(
      path.join(fixtureRoot, "scripts", "client.js"),
      'import { WebContainer } from "@webcontainer/api";\nvoid WebContainer;\n',
    );
    await fs.writeFile(path.join(fixtureRoot, "scripts", "bundle.min.js"), "");
    const report = await analyze({
      rootDir: fixtureRoot,
      entry: [],
      extensions: [".js", ".mjs"],
      includeConventionalEntries: false,
      reportUnusedExports: false,
      layers: { skip3: true, skip4: true },
    });
    expect(report.entryPoints).toContain("scripts/client.js");
    expect(report.entryPoints).not.toContain("scripts/false-positive.js");
    expect(
      report.findings.some(
        (finding) =>
          (finding.rule === "unused-dev-dependency" || finding.rule === "unused-dependency") &&
          finding.evidence?.package === "@webcontainer/api",
      ),
    ).toBe(false);
    expect(
      report.findings.some(
        (finding) =>
          (finding.rule === "missing-dependency" || finding.rule === "missing-dev-dependency") &&
          finding.evidence?.package === "esbuild",
      ),
    ).toBe(false);
    expect(
      report.findings.some(
        (finding) =>
          (finding.rule === "unused-dev-dependency" || finding.rule === "unused-dependency") &&
          finding.evidence?.package === "esbuild",
      ),
    ).toBe(false);
  });

  it("reports a workspace-owned dependency imported by root production code", async () => {
    await fs.mkdir(path.join(fixtureRoot, "packages", "core"), { recursive: true });
    await fs.mkdir(path.join(fixtureRoot, "src"), { recursive: true });
    await fs.writeFile(
      path.join(fixtureRoot, "package.json"),
      JSON.stringify({
        name: "root-production-import",
        private: true,
        workspaces: ["packages/*"],
        type: "module",
      }),
    );
    await fs.writeFile(
      path.join(fixtureRoot, "packages", "core", "package.json"),
      JSON.stringify({ name: "@fixture/core", devDependencies: { esbuild: "1.0.0" } }),
    );
    await fs.writeFile(
      path.join(fixtureRoot, "src", "root.mjs"),
      'import { build } from "esbuild";\nvoid build;\n',
    );

    const report = await analyze({
      rootDir: fixtureRoot,
      entry: ["src/root.mjs"],
      extensions: [".mjs"],
      includeConventionalEntries: false,
      reportUnusedExports: false,
      layers: { skip3: true, skip4: true },
    });

    expect(
      report.findings.some(
        (finding) =>
          (finding.rule === "missing-dependency" || finding.rule === "missing-dev-dependency") &&
          finding.evidence?.package === "esbuild",
      ),
    ).toBe(true);
  });

  it("treats Bun file arguments as reachable roots without treating Bun subcommands as files", async () => {
    await fs.mkdir(path.join(fixtureRoot, "perf"), { recursive: true });
    await fs.mkdir(path.join(fixtureRoot, "test", "integration"), { recursive: true });
    await fs.writeFile(
      path.join(fixtureRoot, "package.json"),
      JSON.stringify(
        {
          name: "bun-package-script-entry-points",
          private: true,
          scripts: {
            perf: "bun perf/bench.ts",
            "test:integration:release": "bun test/integration/release.ts",
            check: "bun run perf/bench.ts",
            unit: "bun test",
          },
        },
        null,
        2,
      ),
    );
    await fs.writeFile(path.join(fixtureRoot, "perf", "bench.ts"), "export const bench = true;\n");
    await fs.writeFile(
      path.join(fixtureRoot, "test", "integration", "release.ts"),
      "export const release = true;\n",
    );

    const report = await analyze({
      rootDir: fixtureRoot,
      entry: [],
      extensions: [".ts"],
      includeConventionalEntries: false,
      reportUnusedExports: false,
    });

    expect(report.entryPoints).toEqual(
      expect.arrayContaining(["perf/bench.ts", "test/integration/release.ts"]),
    );
    expect(report.findings.some((finding) => finding.rule === "missing-script-target")).toBe(false);
  });

  it("reports Vite as unused when Vitest configuration is the only evidence", async () => {
    await fs.mkdir(fixtureRoot, { recursive: true });
    await fs.writeFile(
      path.join(fixtureRoot, "package.json"),
      JSON.stringify(
        {
          name: "vitest-vite-usage",
          private: true,
          devDependencies: { vitest: "3.0.0", vite: "6.0.0" },
        },
        null,
        2,
      ),
    );
    await fs.writeFile(
      path.join(fixtureRoot, "vitest.config.ts"),
      "export default { test: { environment: 'node' } };\n",
    );

    const report = await analyze({
      rootDir: fixtureRoot,
      entry: [],
      extensions: [".ts"],
      includeConventionalEntries: false,
      reportUnusedExports: false,
    });

    expect(report.findings.some((finding) => finding.evidence?.package === "vite")).toBe(true);
    expect(report.findings.some((finding) => finding.evidence?.package === "vitest")).toBe(false);
  });

  it("does not treat pnpm workspace filter selectors as missing dependencies", async () => {
    await fs.mkdir(fixtureRoot, { recursive: true });
    await fs.writeFile(
      path.join(fixtureRoot, "package.json"),
      JSON.stringify(
        {
          name: "pnpm-filter-script",
          private: true,
          scripts: {
            "dev:console": "pnpm --filter @scope/console dev",
            "dev:docs": "pnpm --filter=@scope/docs dev",
            build: "pnpm -F @scope/console build",
          },
        },
        null,
        2,
      ),
    );

    const report = await analyze({
      rootDir: fixtureRoot,
      entry: [],
      extensions: [".ts"],
      includeConventionalEntries: false,
      reportUnusedExports: false,
    });

    expect(
      report.findings.some(
        (finding) =>
          finding.rule === "missing-dependency" &&
          (finding.evidence?.package === "@scope/console" ||
            finding.evidence?.package === "@scope/docs"),
      ),
    ).toBe(false);
  });

  it("resolves pnpm store binaries to their real package names", async () => {
    const typescriptBin = path.join(
      fixtureRoot,
      "node_modules",
      ".pnpm",
      "typescript@5.8.3",
      "node_modules",
      "typescript",
      "bin",
    );
    const vitestBin = path.join(
      fixtureRoot,
      "node_modules",
      ".pnpm",
      "vitest@3.2.7",
      "node_modules",
      "vitest",
      "vitest.mjs",
    );
    await fs.mkdir(typescriptBin, { recursive: true });
    await fs.mkdir(path.dirname(vitestBin), { recursive: true });
    await fs.mkdir(path.join(fixtureRoot, "node_modules", ".bin"), { recursive: true });
    await fs.writeFile(path.join(typescriptBin, "tsc"), "#!/usr/bin/env node\n");
    await fs.writeFile(vitestBin, "#!/usr/bin/env node\n");

    // Omit "file" argument so Windows does not enforce Developer Mode
    await fs.symlink(
      path.join(typescriptBin, "tsc"),
      path.join(fixtureRoot, "node_modules", ".bin", "tsc"),
    );
    await fs.symlink(vitestBin, path.join(fixtureRoot, "node_modules", ".bin", "vitest"));

    await fs.writeFile(
      path.join(fixtureRoot, "package.json"),
      JSON.stringify(
        {
          name: "pnpm-binary-resolution",
          private: true,
          scripts: { build: "tsc", test: "vitest" },
          devDependencies: { typescript: "^5.8.3", vitest: "^3.2.7" },
        },
        null,
        2,
      ),
    );

    const report = await analyze({
      rootDir: fixtureRoot,
      entry: [],
      extensions: [".ts"],
      includeConventionalEntries: false,
      reportUnusedExports: false,
    });

    expect(
      report.findings.some(
        (finding) => finding.rule === "missing-dependency" && finding.evidence?.package === ".pnpm",
      ),
    ).toBe(false);
    expect(report.findings.some((finding) => finding.rule === "missing-dev-dependency")).toBe(
      false,
    );
  });

  it("reports a high-confidence error when a concrete local Node script target is absent", async () => {
    await fs.mkdir(fixtureRoot, { recursive: true });
    await fs.writeFile(
      path.join(fixtureRoot, "package.json"),
      JSON.stringify(
        {
          name: "missing-package-script-target",
          private: true,
          scripts: { verify: "node ./scripts/does-not-exist.mjs" },
        },
        null,
        2,
      ),
    );

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
        targetPath: "scripts/does-not-exist.mjs",
      },
    });
  });
});
