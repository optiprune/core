import fs from "node:fs/promises";
import os from "node:os";
import path from "pathe";
import { afterEach, describe, expect, it } from "vitest";
import { analyze } from "../../src/index.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "optiprune-regression-"));
  roots.push(root);
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(root, name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content);
  }
  return root;
}

describe("OptiPrune regressions", () => {
  it("does not report members from a dynamically imported module", async () => {
    const root = await fixture({
      "src/index.ts":
        "const loaded = await import('./dynamic-module');\nconsole.log(loaded);\n",
      "src/dynamic-module.ts":
        "export const runtimeConfig = { onlyLoadedDynamically: true };\n",
    });
    const result = await analyze({
      rootDir: root,
      entry: ["src/index.ts"],
      includeConventionalEntries: false,
      skip3: true,
      skip4: true,
    });
    expect(result.findings).not.toContainEqual(
      expect.objectContaining({
        rule: "unused-member",
        evidence: expect.objectContaining({ memberName: "onlyLoadedDynamically" }),
      }),
    );
  });

  it("skips impossible-condition checks but still runs ordinary Layer 2 CFG checks", async () => {
    const result = await analyze({
      rootDir: path.resolve(process.cwd()),
      entry: ["tests/fixtures/layer2-test.ts"],
      includeConventionalEntries: false,
      skipSmt: true,
      skip4: true,
    });
    expect(
      result.findings.some((finding) => finding.rule === "constant-condition"),
    ).toBe(false);
    expect(
      result.findings.some((finding) => finding.rule === "contradictory-guard"),
    ).toBe(false);
    expect(
      result.findings.some((finding) => finding.rule === "unreachable-statement"),
    ).toBe(true);
  });

  it("resolves pnpm store binaries to their actual packages", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        name: "pnpm-regression",
        scripts: { build: "tsc", test: "vitest" },
        devDependencies: { typescript: "^5.8.3", vitest: "^3.2.7" },
      }),
    });
    const typescriptBin = path.join(
      root,
      "node_modules/.pnpm/typescript@5.8.3/node_modules/typescript/bin/tsc",
    );
    const vitestBin = path.join(
      root,
      "node_modules/.pnpm/vitest@3.2.7/node_modules/vitest/vitest.mjs",
    );
    await fs.mkdir(path.dirname(typescriptBin), { recursive: true });
    await fs.mkdir(path.dirname(vitestBin), { recursive: true });
    await fs.mkdir(path.join(root, "node_modules/.bin"), { recursive: true });
    await fs.writeFile(typescriptBin, "#!/usr/bin/env node\n");
    await fs.writeFile(vitestBin, "#!/usr/bin/env node\n");

    // Omit the "file" argument so Windows does not enforce Developer Mode
    await fs.symlink(typescriptBin, path.join(root, "node_modules/.bin/tsc"));
    await fs.symlink(vitestBin, path.join(root, "node_modules/.bin/vitest"));

    const result = await analyze({
      rootDir: root,
      includeConventionalEntries: false,
      reportUnusedExports: false,
    });
    expect(result.findings.some((finding) => finding.evidence?.package === ".pnpm")).toBe(
      false,
    );
    expect(
      result.findings.some((finding) => finding.rule === "missing-dev-dependency"),
    ).toBe(false);
  });

  it("classifies missing script tools as missing devDependencies", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        name: "missing-dev-regression",
        scripts: { build: "tsc" },
      }),
    });
    const result = await analyze({
      rootDir: root,
      includeConventionalEntries: false,
      reportUnusedExports: false,
    });
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        rule: "missing-dev-dependency",
        evidence: expect.objectContaining({
          package: "typescript",
          type: "devDependency",
        }),
      }),
    );
  });
});