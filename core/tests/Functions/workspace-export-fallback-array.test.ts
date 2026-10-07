import { promises as fs } from "node:fs";
import os from "node:os";
import path from "pathe";
import { afterEach, describe, expect, it } from "vitest";
import { analyze } from "../../src/index.js";
import { pickPackageExportTarget, resolvePackageExportTargets } from "../../src/fs-utils.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function rootWith(files: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "optiprune-workspace-exports-"));
  roots.push(root);
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(root, name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content);
  }
  return root;
}

describe("package export target selection", () => {
  it("picks the first resolvable entry of a fallback array", () => {
    expect(pickPackageExportTarget(["./dist/index.js", "./dist/fallback.js"])).toBe(
      "./dist/index.js",
    );
    expect(pickPackageExportTarget([{ import: "./dist/esm.js" }, "./dist/cjs.js"])).toBe(
      "./dist/esm.js",
    );
  });

  it("returns undefined for an empty or unresolvable array", () => {
    expect(pickPackageExportTarget([])).toBeUndefined();
    expect(pickPackageExportTarget([[], {}])).toBeUndefined();
  });

  it("evaluates runtime conditions in order, keeping default last", () => {
    expect(
      pickPackageExportTarget({ default: "./dist/legacy.js", import: "./dist/index.js" }),
    ).toBe("./dist/index.js");
    expect(
      pickPackageExportTarget({ browser: "./dist/browser.js", import: "./dist/index.js" }),
    ).toBe("./dist/browser.js");
  });

  it("skips type-only surfaces and can exclude development conditions", () => {
    expect(
      pickPackageExportTarget({ types: "./dist/index.d.ts", default: "./dist/index.js" }),
    ).toBe("./dist/index.js");
    // A project-specific condition is honored outside production, but a standard
    // runtime condition always wins over it.
    expect(
      pickPackageExportTarget({ development: "./src/dev.ts", default: "./src/index.ts" }, false),
    ).toBe("./src/dev.ts");
    expect(
      pickPackageExportTarget({ development: "./src/dev.ts", default: "./src/index.ts" }, true),
    ).toBe("./src/index.ts");
    expect(
      pickPackageExportTarget({ development: "./src/dev.ts", import: "./src/index.ts" }, false),
    ).toBe("./src/index.ts");
  });
});

describe("package export subpath resolution", () => {
  it("matches exact and wildcard subpaths", () => {
    const field = {
      ".": ["./dist/index.js", "./dist/fallback.js"],
      "./chart": { import: "./dist/chart.js", default: "./dist/chart.cjs" },
      "./features/*": { default: "./dist/features/*.js" },
    };
    expect(resolvePackageExportTargets(field, ".")).toMatchObject({
      matched: true,
      target: "./dist/index.js",
    });
    expect(resolvePackageExportTargets(field, "./chart").target).toBe("./dist/chart.js");
    expect(resolvePackageExportTargets(field, "./features/alpha").target).toBe(
      "./dist/features/*.js",
    );
    expect(resolvePackageExportTargets(field, "./missing")).toMatchObject({ matched: false });
  });

  it("treats a bare condition map or array as the root export", () => {
    expect(resolvePackageExportTargets({ import: "./dist/index.js" }, ".").target).toBe(
      "./dist/index.js",
    );
    expect(resolvePackageExportTargets(["./dist/index.js"], ".").target).toBe("./dist/index.js");
    expect(resolvePackageExportTargets({ import: "./dist/index.js" }, "./other").matched).toBe(
      false,
    );
  });
});

describe("workspace export fallback arrays", () => {
  it("resolves an array-only exports field to the package source file", async () => {
    const root = await rootWith({
      "package.json": JSON.stringify({
        name: "workspace-export-root",
        private: true,
        workspaces: ["packages/*"],
      }),
      "packages/lib/package.json": JSON.stringify({
        name: "@workspace/lib",
        private: true,
        exports: ["./dist/index.js", "./dist/fallback.js"],
      }),
      "packages/lib/src/index.ts": "export const used = 1;\nexport const unused = 2;\n",
      "packages/app/package.json": JSON.stringify({
        name: "@workspace/app",
        private: true,
        dependencies: { "@workspace/lib": "*" },
      }),
      "packages/app/src/index.ts": 'import { used } from "@workspace/lib";\nconsole.log(used);\n',
    });

    const report = await analyze({
      rootDir: root,
      entry: [],
      extensions: [".ts"],
      includeConventionalEntries: false,
      reportUnusedExports: false,
    });

    const appModule = report.modules.find((module) => module.path.endsWith("app/src/index.ts"));
    const edge = appModule?.edges.find((candidate) => candidate.specifier === "@workspace/lib");
    expect(edge?.resolution).toBe("resolved");
    expect(edge?.target).toContain("packages/lib/src/index.ts");

    expect(
      report.findings.some(
        (finding) =>
          finding.rule === "unresolved-import" && finding.file.endsWith("app/src/index.ts"),
      ),
    ).toBe(false);
    expect(
      report.findings.some(
        (finding) =>
          finding.rule === "unused-dependency" && finding.evidence?.package === "@workspace/lib",
      ),
    ).toBe(false);
  });

  it("resolves a condition map to the source of the selected build target", async () => {
    const root = await rootWith({
      "package.json": JSON.stringify({
        name: "workspace-condition-root",
        private: true,
        workspaces: ["packages/*"],
      }),
      "packages/lib/package.json": JSON.stringify({
        name: "@workspace/cond",
        private: true,
        exports: {
          ".": { default: "./dist/legacy.js", import: "./dist/index.js" },
        },
      }),
      "packages/lib/src/index.ts": "export const modern = true;\n",
      "packages/lib/src/legacy.ts": "export const legacy = true;\n",
      "packages/app/package.json": JSON.stringify({
        name: "@workspace/cond-app",
        private: true,
        dependencies: { "@workspace/cond": "*" },
      }),
      "packages/app/src/index.ts":
        'import { modern } from "@workspace/cond";\nconsole.log(modern);\n',
    });

    const report = await analyze({
      rootDir: root,
      entry: [],
      extensions: [".ts"],
      includeConventionalEntries: false,
      reportUnusedExports: false,
    });

    const appModule = report.modules.find((module) => module.path.endsWith("app/src/index.ts"));
    const edge = appModule?.edges.find((candidate) => candidate.specifier === "@workspace/cond");
    expect(edge?.target).toContain("packages/lib/src/index.ts");
  });
});
