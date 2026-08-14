import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "pathe";
import { analyze } from "../src/index.js";
import { KnipPlugin } from "../src/plugins/knip-plugin.js";
import { YarnPlugin } from "../src/plugins/yarn-plugin.js";
import { PluginEngine } from "../src/engine.js";
import { DEFAULT_CONFIG } from "../src/config-loader.js";
import { NextjsPlugin } from "../src/plugins/nextjs-plugin.js";
import { ReactPlugin } from "../src/plugins/react-plugin.js";
import { ExpoPlugin } from "../src/plugins/expo-plugin.js";
import { ReactNativePlugin } from "../src/plugins/react-native-plugin.js";
import { NuxtPlugin } from "../src/plugins/nuxtjs-plugin.js";
import { VitestPlugin } from "../src/plugins/vitest-plugin.js";

const temporaryRoots: string[] = [];

async function createProject(files: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "optiprune-plugin-config-"));
  temporaryRoots.push(root);
  await Promise.all(Object.entries(files).map(async ([relativePath, content]) => {
    const target = path.join(root, relativePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content);
  }));
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("Plugin configuration integration", () => {
  it("applies Knip entries, project scope, workspace globs, and selective report ignores", async () => {
    const root = await createProject({
      "package.json": JSON.stringify({ devDependencies: { knip: "1.0.0" } }),
      "knip.json": JSON.stringify({
        entry: ["src/main.ts"],
        project: ["src/**/*.ts"],
        ignoreFiles: ["src/generated.ts"],
        ignoreIssues: { "src/suppressed.ts": ["exports"] },
        workspaces: {
          "packages/*": {
            entry: ["src/index.ts"],
            project: ["src/**/*.ts"],
          },
        },
      }),
      "src/main.ts": "import { helper } from './helper'; import './suppressed'; console.log(helper);\n",
      "src/helper.ts": "export const helper = 1;\n",
      "src/suppressed.ts": "export const intentionallyExposed = 1;\n",
      "src/generated.ts": "export const generatedOnly = 1;\n",
      "packages/lib/package.json": JSON.stringify({ name: "@fixture/lib", version: "1.0.0" }),
      "packages/lib/src/index.ts": "export const packageEntry = 1;\n",
    });

    const report = await analyze({
      rootDir: root,
      includeConventionalEntries: false,
      reportUnusedExports: true,
      layers: { skip3: true, skip4: true },
    });

    expect(report.entryPoints).toContain("src/main.ts");
    expect(report.entryPoints).toContain("packages/lib/src/index.ts");
    expect(report.findings.some((finding) => finding.rule === "unreachable-file" && finding.file.endsWith("src/generated.ts"))).toBe(false);
    expect(report.findings.some((finding) => finding.rule === "unused-export" && finding.file.endsWith("src/suppressed.ts"))).toBe(false);
  });

  it("uses Yarn workspaces as genuine monorepo metadata", async () => {
    const root = await createProject({
      "package.json": JSON.stringify({ packageManager: "yarn@4.0.0", workspaces: ["packages/*"] }),
      "yarn.lock": "# yarn lockfile\n",
      "packages/lib/package.json": JSON.stringify({ name: "@fixture/lib", version: "1.0.0" }),
    });
    const options = {
      ...DEFAULT_CONFIG,
      rootDir: root,
      entry: [],
      ignore: [],
      workspaceGlobs: [],
      projectPatterns: [],
      unreachableFileIgnorePatterns: [],
      protectedExportPatterns: [],
    } as any;
    const context = { modules: new Map(), options } as any;
    const adapter = new PluginEngine().createAdapter(context);

    await YarnPlugin.lifecycle.onProjectInit!(adapter);

    expect(options.workspaceGlobs).toEqual(["packages/*"]);
    expect(options.repositoryType).toBe("monorepo");
  });

  it("does not classify a next dependency alone as a Next.js application", async () => {
    const nextOnlyAdapter = {
      readJson: async (file: string) => file === "package.json"
        ? { dependencies: { next: "1.0.0", react: "1.0.0" } }
        : null,
      folderExists: async () => false,
    } as any;

    await expect(NextjsPlugin.detect!(nextOnlyAdapter)).resolves.toBe(false);
  });

  it("classifies a Next.js app only when a next dependency is corroborated by route evidence", async () => {
    const nextAppAdapter = {
      readJson: async (file: string) => file === "package.json"
        ? { dependencies: { next: "1.0.0", react: "1.0.0" } }
        : null,
      folderExists: async (file: string) => file === "src/app/page.tsx",
    } as any;

    await expect(NextjsPlugin.detect!(nextAppAdapter)).resolves.toBe(true);
  });

  it("does not classify a JSX compiler setting as React framework ownership", async () => {
    const jsxOnlyAdapter = {
      readJson: async (file: string) => file === "tsconfig.json"
        ? { compilerOptions: { jsx: "preserve" } }
        : {},
    } as any;

    await expect(ReactPlugin.detect!(jsxOnlyAdapter)).resolves.toBe(false);
  });

  it("does not classify an Expo dependency alone as an Expo application", async () => {
    const adapter = {
      readJson: async (file: string) => file === "package.json" ? { dependencies: { expo: "1.0.0" } } : null,
      folderExists: async () => false,
    } as any;

    await expect(ExpoPlugin.detect!(adapter)).resolves.toBe(false);
  });

  it("does not classify a React Native dependency plus a generic manifest as React Native", async () => {
    const adapter = {
      readJson: async (file: string) => file === "package.json"
        ? { dependencies: { "react-native": "1.0.0" } }
        : file === "app.json" ? { name: "generic-web-tool" } : null,
      folderExists: async (file: string) => file === "app.json",
    } as any;

    await expect(ReactNativePlugin.detect!(adapter)).resolves.toBe(false);
  });

  it("does not classify a Nuxt dependency alone as a Nuxt application", async () => {
    const adapter = {
      readJson: async (file: string) => file === "package.json" ? { dependencies: { nuxt: "1.0.0" } } : null,
      folderExists: async () => false,
    } as any;

    await expect(NuxtPlugin.detect!(adapter)).resolves.toBe(false);
  });

  it("does not claim a generic app.json as an Expo configuration", async () => {
    const adapter = {
      folderExists: async (file: string) => file === "app.json",
      readJson: async (file: string) => file === "app.json" ? { name: "unrelated-tool", version: "1.0.0" } : {},
    } as any;

    await expect(ExpoPlugin.detect!(adapter)).resolves.toBe(false);
  });

  it("reports a missing jsdom dependency from a defineConfig Vitest config", async () => {
    const root = await createProject({
      "package.json": JSON.stringify({
        devDependencies: { vitest: "1.0.0" },
      }),
      "vitest.config.ts": [
        'import { defineConfig } from "vitest/config";',
        'export default defineConfig({ test: { environment: "jsdom" } });',
      ].join("\n"),
    });

    const report = await analyze({
      rootDir: root,
      includeConventionalEntries: false,
      reportUnusedExports: false,
      layers: { skip3: true, skip4: true },
    });

    expect(report.findings.some((finding) =>
      finding.rule === "missing-dependency" &&
      finding.message.includes("jsdom") &&
      finding.message.includes("vitest.config.ts")
    )).toBe(true);
  });

  it("claims a Knip configuration only through a Knip-specific location or package key", async () => {
    const adapter = {
      folderExists: async (file: string) => file === "knip.json",
      readFile: async (file: string) => file === "knip.json" ? JSON.stringify({ entry: ["src/main.ts"] }) : null,
      readJson: async () => ({}),
      markAsUsed: () => undefined,
    } as any;

    await expect(KnipPlugin.detect!(adapter)).resolves.toBe(true);
  });
});
