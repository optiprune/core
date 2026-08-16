import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "pathe";
import { analyze } from "../src/index.js";

async function createWorkflowFixture(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "optiprune-github-actions-"));
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.mkdir(path.join(root, "scripts"), { recursive: true });
  await fs.mkdir(path.join(root, ".github", "workflows"), { recursive: true });
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify({
    name: "github-actions-fixture",
    private: true,
    scripts: { release: "node scripts/release.js", test: "node scripts/test.js" },
  }, null, 2));
  await fs.writeFile(path.join(root, "src", "index.ts"), "export const entry = true;\n");
  await fs.writeFile(path.join(root, "scripts", "build.ts"), "export const build = true;\n");
  await fs.writeFile(path.join(root, "scripts", "release.js"), "console.log('release');\n");
  await fs.writeFile(path.join(root, "scripts", "test.js"), "console.log('test');\n");
  await fs.writeFile(path.join(root, "scripts", "deploy.js"), "console.log('deploy');\n");
  await fs.writeFile(path.join(root, ".github", "workflows", "ci.yml"), `
name: CI
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: node ./scripts/build.ts
      - run: npm run release
      - run: pnpm run test
`);
  await fs.writeFile(path.join(root, ".github", "workflows", "deploy.yaml"), `
name: Deploy
on: workflow_dispatch
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - run: ./scripts/deploy.js
`);
  return root;
}

describe("GitHub Actions workflow script usage", () => {
  it("marks every workflow and scripts referenced by run commands as used", async () => {
    const root = await createWorkflowFixture();
    try {
      const report = await analyze({
        rootDir: root,
        entry: ["src/index.ts"],
        includeConventionalEntries: false,
        reportUnusedExports: true,
        layers: { skip3: true, skip4: true },
      });
      const unreachable = (suffix: string) => report.findings.some((finding) =>
        finding.rule === "unreachable-file" && finding.file.endsWith(suffix),
      );

      expect(unreachable(".github/workflows/ci.yml")).toBe(false);
      expect(unreachable(".github/workflows/deploy.yaml")).toBe(false);
      expect(unreachable("scripts/build.ts")).toBe(false);
      expect(unreachable("scripts/release.js")).toBe(false);
      expect(unreachable("scripts/test.js")).toBe(false);
      expect(unreachable("scripts/deploy.js")).toBe(false);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
