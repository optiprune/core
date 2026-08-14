import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "pathe";
import { analyze } from "../src/index.js";

const temporaryRoots: string[] = [];

async function createProject(files: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "optiprune-nightmare-"));
  temporaryRoots.push(root);

  await Promise.all(Object.entries(files).map(async ([relativePath, content]) => {
    const target = path.join(root, relativePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, "utf8");
  }));

  return root;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("nightmare monorepo regressions", () => {
  it("discovers a workspace Next config, resolves its local alias, and does not promote ordinary app source files to entries", async () => {
    const root = await createProject({
      "package.json": JSON.stringify({
        private: true,
        packageManager: "pnpm@9.0.0",
        devDependencies: {
          "@vanilla-extract/next-plugin": "1.0.0",
          vitest: "1.0.0",
        },
      }),
      "pnpm-workspace.yaml": "packages:\n  - apps/*\n",
      "apps/web/package.json": JSON.stringify({
        name: "@fixture/web",
        private: true,
        dependencies: { next: "1.0.0", react: "1.0.0" },
      }),
      "apps/web/next.config.mjs": 'import withVanillaExtract from "@vanilla-extract/next-plugin"; export default withVanillaExtract({});\n',
      "apps/web/tsconfig.json": JSON.stringify({
        compilerOptions: { paths: { "@/*": ["./src/*"] } },
      }),
      "apps/web/src/app/page.tsx": 'import { active } from "@/lib/active"; export default function Page() { return active; }\n',
      "apps/web/src/lib/active.ts": "export const active = 1;\n",
      "apps/web/src/middleware.ts": "export function middleware() { return undefined; }\n",
      "apps/web/vitest.config.ts": "export default { test: { setupFiles: ['./src/test-setup.ts'] } };\n",
      "apps/web/src/test-setup.ts": "export const setup = true;\n",
      "apps/web/src/components/UnusedDashboardTile.tsx": "export default function UnusedDashboardTile() { return null; }\n",
    });

    const report = await analyze({
      rootDir: root,
      reportUnusedExports: false,
      layers: { skip3: true, skip4: true },
    });

    expect(report.findings.some((finding) =>
      finding.rule === "unreachable-file" && finding.file.endsWith("apps/web/next.config.mjs"),
    )).toBe(false);
    expect(report.findings.some((finding) =>
      finding.rule === "missing-dependency" && finding.message.includes("@/lib"),
    )).toBe(false);
    expect(report.findings.some((finding) =>
      finding.rule === "@vanilla-extract/next-plugin",
    )).toBe(false);
    for (const entryFile of ["apps/web/src/middleware.ts", "apps/web/src/test-setup.ts"]) {
      expect(report.findings.some((finding) =>
        finding.rule === "unreachable-file" && finding.file.endsWith(entryFile),
      )).toBe(false);
    }
    expect(report.findings.some((finding) =>
      finding.rule === "unreachable-file" && finding.file.endsWith("UnusedDashboardTile.tsx"),
    )).toBe(true);
  });

  it("protects exports in a GraphQL Code Generator target declared by the configuration", async () => {
    const root = await createProject({
      "package.json": JSON.stringify({
        private: true,
        devDependencies: {
          "@graphql-codegen/cli": "1.0.0",
          graphql: "1.0.0",
        },
      }),
      "codegen.ts": [
        'import type { CodegenConfig } from "@graphql-codegen/cli";',
        'const config: CodegenConfig = { generates: { "src/generated/graphql.ts": { preset: "client" } } };',
        "export default config;",
      ].join("\n"),
      "src/generated/graphql.ts": "export const AccountDocument = {};\n",
    });

    const report = await analyze({
      rootDir: root,
      includeConventionalEntries: false,
      layers: { skip3: true, skip4: true },
    });

    expect(report.findings.some((finding) =>
      finding.rule === "unused-export" &&
      finding.file.endsWith("src/generated/graphql.ts") &&
      finding.evidence?.exportName === "AccountDocument",
    )).toBe(false);
    expect(report.findings.some((finding) => finding.rule === "graphql")).toBe(false);
  });

  it("attributes workspace imports and type support to root dev dependencies but reports bare Husky and unused ESLint plugins", async () => {
    const root = await createProject({
      "package.json": JSON.stringify({
        private: true,
        packageManager: "pnpm@9.0.0",
        devDependencies: {
          "@testing-library/react": "1.0.0",
          "@types/react": "1.0.0",
          typescript: "1.0.0",
          husky: "1.0.0",
          "eslint-plugin-import": "1.0.0",
        },
      }),
      "pnpm-workspace.yaml": "packages:\n  - apps/*\n",
      "apps/web/package.json": JSON.stringify({
        name: "@fixture/web",
        private: true,
        dependencies: { react: "1.0.0" },
      }),
      "apps/web/src/main.test.tsx": 'import { render } from "@testing-library/react"; export const testView = render;\n',
    });

    const report = await analyze({
      rootDir: root,
      includeConventionalEntries: false,
      reportUnusedExports: false,
      layers: { skip3: true, skip4: true },
    });

    for (const dependency of ["@testing-library/react", "@types/react", "typescript"]) {
      expect(report.findings.some((finding) => finding.rule === dependency)).toBe(false);
    }
    expect(report.findings.some((finding) => finding.rule === "husky")).toBe(true);
    expect(report.findings.some((finding) => finding.rule === "eslint-plugin-import")).toBe(true);
  });

  it("does not treat private workspace export maps as an external contract", async () => {
    const root = await createProject({
      "package.json": JSON.stringify({
        private: true,
        packageManager: "pnpm@9.0.0",
      }),
      "pnpm-workspace.yaml": "packages:\n  - apps/*\n  - packages/*\n",
      "apps/web/package.json": JSON.stringify({
        name: "@fixture/web",
        private: true,
        dependencies: { "@fixture/ui": "workspace:*" },
      }),
      "apps/web/src/main.ts": 'import { Badge } from "@fixture/ui"; import { Chart } from "@fixture/ui/chart"; console.log(Badge, Chart);\n',
      "packages/ui/package.json": JSON.stringify({
        name: "@fixture/ui",
        private: true,
        exports: { ".": "./src/index.ts" },
      }),
      "packages/ui/src/index.ts": 'export { Badge, GhostBadge } from "./Badge";\n',
      "packages/ui/src/Badge.ts": "export const Badge = 1; export const GhostBadge = 2;\n",
      "packages/ui/src/Chart.ts": "export const Chart = 3;\n",
    });

    const report = await analyze({
      rootDir: root,
      entry: ["apps/web/src/main.ts"],
      includeConventionalEntries: false,
      layers: { skip3: true, skip4: true },
    });

    expect(report.findings.some((finding) =>
      finding.rule === "unused-export" &&
      finding.file.endsWith("packages/ui/src/Badge.ts") &&
      finding.evidence?.exportName === "GhostBadge",
    )).toBe(true);
    expect(report.findings.some((finding) =>
      finding.rule === "unused-export" &&
      finding.file.endsWith("packages/ui/src/Chart.ts") &&
      finding.evidence?.exportName === "Chart",
    )).toBe(false);
  });
});
