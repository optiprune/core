import { promises as fs } from "node:fs";
import os from "node:os";
import path from "pathe";
import { afterEach, describe, expect, it } from "vitest";
import { analyze } from "../../src/index.js";
import { jestModuleCandidates } from "../../src/plugins/jest-plugin.js";
import { resolveVitestRoot } from "../../src/plugins/vitest-plugin.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function rootWith(files: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "optiprune-test-runner-"));
  roots.push(root);
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(root, name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content);
  }
  return root;
}

function unusedDependencies(findings: Array<{ rule: string; evidence: Record<string, unknown> }>) {
  return findings
    .filter((finding) => finding.rule === "unused-dependency")
    .map((finding) => String(finding.evidence.package ?? ""));
}

describe("Jest short integration names", () => {
  it("probes the prefixed package before the literal short name", () => {
    expect(jestModuleCandidates("jsdom", "jest-environment-")).toEqual([
      "jest-environment-jsdom",
      "jsdom",
    ]);
    expect(jestModuleCandidates("jest-runner-groups", "jest-runner-")).toEqual([
      "jest-runner-groups",
    ]);
    expect(jestModuleCandidates("@scope/env", "jest-environment-")).toEqual(["@scope/env"]);
    expect(jestModuleCandidates("typeahead/filename", "jest-watch-")).toEqual([
      "jest-watch-typeahead/filename",
      "typeahead/filename",
    ]);
  });

  it("marks the prefixed environment, runner and watch plugin as used", async () => {
    const root = await rootWith({
      "package.json": JSON.stringify({
        name: "jest-short-names",
        private: true,
        devDependencies: {
          jest: "^29.0.0",
          "jest-environment-jsdom": "^29.0.0",
          "jest-runner-groups": "^2.2.0",
          "jest-watch-typeahead": "^2.0.0",
        },
      }),
      "jest.config.js": [
        "module.exports = {",
        '  runner: "groups",',
        '  testEnvironment: "jsdom",',
        '  watchPlugins: ["typeahead/filename"],',
        "};",
        "",
      ].join("\n"),
      "src/index.ts": "export const value = 1;\n",
    });

    const report = await analyze({
      rootDir: root,
      entry: ["src/index.ts"],
      extensions: [".ts"],
      includeConventionalEntries: false,
      reportUnusedExports: false,
    });

    const unused = unusedDependencies(report.findings);
    expect(unused).not.toContain("jest-environment-jsdom");
    expect(unused).not.toContain("jest-runner-groups");
    expect(unused).not.toContain("jest-watch-typeahead");
  });

  it("does not demand the bundled Node environment package", async () => {
    const root = await rootWith({
      "package.json": JSON.stringify({
        name: "jest-node-env",
        private: true,
        devDependencies: { jest: "^29.0.0" },
      }),
      "jest.config.js": 'module.exports = { testEnvironment: "node" };\n',
      "src/index.ts": "export const value = 1;\n",
    });

    const report = await analyze({
      rootDir: root,
      entry: ["src/index.ts"],
      extensions: [".ts"],
      includeConventionalEntries: false,
      reportUnusedExports: false,
    });

    expect(
      report.findings.some(
        (finding) =>
          finding.rule === "missing-dependency" &&
          String(finding.evidence.packageName ?? "") === "jest-environment-node",
      ),
    ).toBe(false);
  });

  it("does not leak declared short-name packages into the next analysis", async () => {
    const firstRoot = await rootWith({
      "package.json": JSON.stringify({
        name: "first-jest-project",
        private: true,
        devDependencies: {
          jest: "^29.0.0",
          "jest-environment-jsdom": "^29.0.0",
        },
      }),
      "jest.config.js": 'module.exports = { testEnvironment: "jsdom" };\n',
      "src/index.ts": "export const value = 1;\n",
    });
    await analyze({
      rootDir: firstRoot,
      entry: ["src/index.ts"],
      extensions: [".ts"],
      includeConventionalEntries: false,
      reportUnusedExports: false,
    });

    const secondRoot = await rootWith({
      "package.json": JSON.stringify({
        name: "second-jest-project",
        private: true,
        devDependencies: { jest: "^29.0.0", jsdom: "^24.0.0" },
      }),
      "jest.config.js": 'module.exports = { testEnvironment: "jsdom" };\n',
      "src/index.ts": "export const value = 1;\n",
    });
    const report = await analyze({
      rootDir: secondRoot,
      entry: ["src/index.ts"],
      extensions: [".ts"],
      includeConventionalEntries: false,
      reportUnusedExports: false,
    });

    expect(unusedDependencies(report.findings)).not.toContain("jsdom");
  });
});
describe("Vitest root resolution", () => {
  it("resolves the root from test.root, then root, then the config directory", () => {
    expect(resolveVitestRoot("packages/app/vitest.config.ts", {})).toBe("packages/app");
    expect(resolveVitestRoot("packages/app/vitest.config.ts", { root: "packages/app" })).toBe(
      path.join("packages/app", "packages/app"),
    );
    expect(
      resolveVitestRoot("packages/app/vitest.config.ts", { test: { root: "packages/app" } }),
    ).toBe(path.join("packages/app", "packages/app"));
    expect(
      resolveVitestRoot("packages/app/vitest.config.ts", { test: { root: "/abs/root" } }),
    ).toBe("/abs/root");
  });

  it("resolves setupFiles and test entries against a configured root", async () => {
    const root = await rootWith({
      "package.json": JSON.stringify({
        name: "vitest-root-fixture",
        private: true,
        devDependencies: { vitest: "^3.0.0" },
      }),
      "vitest.config.ts": [
        'import { defineConfig } from "vitest/config";',
        "export default defineConfig({",
        '  root: "packages/app",',
        "  test: {",
        '    setupFiles: ["./test/setup.ts"],',
        '    include: ["test/**/*.spec.ts"],',
        "  },",
        "});",
        "",
      ].join("\n"),
      "packages/app/test/setup.ts": "export const setup = true;\n",
      "packages/app/test/math.spec.ts":
        'import { setup } from "./setup";\nimport { add } from "../src/math";\nconsole.log(setup, add(1, 2));\n',
      "packages/app/src/math.ts": "export const add = (a: number, b: number) => a + b;\n",
    });

    const report = await analyze({
      rootDir: root,
      entry: [],
      extensions: [".ts"],
      includeConventionalEntries: false,
      reportUnusedExports: false,
    });

    expect(report.entryPoints).toEqual(expect.arrayContaining(["packages/app/test/math.spec.ts"]));
    expect(
      report.findings.some(
        (finding) =>
          finding.rule === "unreachable-file" &&
          (finding.file.endsWith("test/setup.ts") || finding.file.endsWith("math.spec.ts")),
      ),
    ).toBe(false);
    expect(unusedDependencies(report.findings)).not.toContain("vitest");
  });
});
