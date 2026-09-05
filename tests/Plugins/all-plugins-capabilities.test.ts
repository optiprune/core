import { access, readFile, readdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import fg from "fast-glob";
import path from "pathe";
import { describe, expect, it } from "vitest";

type Finding = Record<string, unknown>;

const pluginsDir = path.dirname(
  fileURLToPath(new URL("../../src/plugins/vite-plugin.ts", import.meta.url)),
);
const fixturesRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/plugins/individual",
);

function universalManifest() {
  const dependencyBag = new Proxy<Record<string, string>>(
    {},
    {
      get: (_target, property) => (typeof property === "string" ? "99.0.0" : undefined),
      has: () => true,
      ownKeys: () => [],
      getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true, value: "99.0.0" }),
    },
  );
  return {
    name: "all-plugin-capabilities-fixture",
    private: true,
    dependencies: dependencyBag,
    devDependencies: dependencyBag,
    peerDependencies: dependencyBag,
    optionalDependencies: dependencyBag,
    scripts: new Proxy<Record<string, string>>({}, { get: () => "tool --config config.ts" }),
  };
}

function createCapabilityAdapter(fixtureRoot: string) {
  const usedFiles = new Set<string>();
  const usedPackages = new Set<string>();
  const findings: Finding[] = [];
  const resolveFixturePath = (file: string) =>
    path.isAbsolute(file) ? file : path.resolve(fixtureRoot, file);
  const relativeFixturePath = (file: string) =>
    path.relative(fixtureRoot, resolveFixturePath(file));
  const genericSource = [
    'import { defineConfig } from "vite";',
    'import React from "react";',
    "export default defineConfig({});",
    "export const config = {};",
  ].join("\n");
  const adapter: any = new Proxy(
    {
      getConfig: () => ({
        rootDir: fixtureRoot,
        entry: [],
        projectPatterns: [],
        compilers: {
          ".less": { compile: () => "" },
          ".scss": { compile: () => "" },
          ".sass": { compile: () => "" },
          ".styl": { compile: () => "" },
          ".tsrx": { compile: () => "" },
        },
      }),
      readJson: async (file: string) => {
        try {
          return JSON.parse(await readFile(resolveFixturePath(file), "utf8"));
        } catch {
          return file === "package.json" ? universalManifest() : {};
        }
      },
      readFile: async (file: string) => {
        try {
          return await readFile(resolveFixturePath(file), "utf8");
        } catch {
          return genericSource;
        }
      },
      folderExists: async (file: string) => {
        try {
          await access(resolveFixturePath(file));
          return true;
        } catch {
          return false;
        }
      },
      fileExists: async (file: string) => {
        try {
          await access(resolveFixturePath(file));
          return true;
        } catch {
          return false;
        }
      },
      findFiles: async (patterns: string[] | string[]) =>
        fg.sync(Array.isArray(patterns) ? patterns : [patterns], {
          cwd: fixtureRoot,
          dot: true,
          onlyFiles: true,
        }),
      findFilesByGlob: async (patterns: string[] | string[]) =>
        fg.sync(Array.isArray(patterns) ? patterns : [patterns], {
          cwd: fixtureRoot,
          dot: true,
          onlyFiles: true,
        }),
      markAsUsed: (file: string) => usedFiles.add(relativeFixturePath(String(file))),
      markPackageAsUsed: (pkg: string) => usedPackages.add(String(pkg)),
      markConfigFileAsUsed: (file: string) => usedFiles.add(relativeFixturePath(String(file))),
      emitFinding: (finding: Finding) => findings.push(finding),
      addEntryPatterns: () => undefined,
      addIgnorePatterns: () => undefined,
      addProjectPatterns: () => undefined,
      addUnreachableFileIgnorePatterns: () => undefined,
      setMonorepo: () => undefined,
      attachMetadata: () => undefined,
      isFileIgnored: async () => false,
      isFileUsed: () => false,
      getPackageInfo: async () => universalManifest(),
    },
    {
      get: (target, property, receiver) => {
        if (Reflect.has(target, property)) return Reflect.get(target, property, receiver);
        return (..._args: unknown[]) => undefined;
      },
    },
  );
  return { adapter, usedFiles, usedPackages, findings };
}

describe("all registered plugins have executable capabilities", () => {
  it("detects and initializes every plugin against a comprehensive project fixture", async () => {
    const pluginFiles = (await readdir(pluginsDir))
      .filter((file) => file.endsWith("-plugin.ts"))
      .sort();
    expect(pluginFiles.length).toBeGreaterThanOrEqual(180);

    const failures: string[] = [];
    for (const file of pluginFiles) {
      const module = await import(pathToFileURL(path.join(pluginsDir, file)).href);
      const plugin =
        module.default ??
        Object.values(module).find((value: any) => value?.name?.endsWith("-plugin"));
      const fixtureRoot = path.join(fixturesRoot, file.replace(/-plugin\.ts$/, ""));
      const metadata = JSON.parse(
        await readFile(path.join(fixtureRoot, "fixture.meta.json"), "utf8"),
      );
      const capability = createCapabilityAdapter(fixtureRoot);
      const negativeCapability = createCapabilityAdapter(path.join(fixtureRoot, "negative"));
      if (!plugin || typeof plugin.name !== "string") {
        failures.push(`${file}: no AnalyzerPlugin export`);
        continue;
      }
      try {
        const pluginName = file.replace(/-plugin\.ts$/, "");
        let positiveDetected = false;
        if (metadata.plugin !== pluginName) {
          failures.push(`${file}: fixture metadata points to ${String(metadata.plugin)}`);
        }
        if (!metadata.cases?.includes("positive") || !metadata.cases?.includes("negative")) {
          failures.push(`${file}: fixture metadata is missing positive/negative cases`);
        }
        if (typeof plugin.detect === "function") {
          const detectedPositive = await plugin.detect(capability.adapter);
          const detectedNegative = await plugin.detect(negativeCapability.adapter);
          positiveDetected = detectedPositive === true;
          if (typeof detectedPositive !== "boolean" || typeof detectedNegative !== "boolean") {
            failures.push(`${file}: detect() did not return booleans for both fixture cases`);
          }
        }
        if (typeof plugin.lifecycle?.onProjectInit === "function") {
          await plugin.lifecycle.onProjectInit(capability.adapter);
        }
        if (typeof plugin.lifecycle?.onFileStart === "function") {
          await plugin.lifecycle.onFileStart("package.json", capability.adapter);
          await plugin.lifecycle.onFileStart("src-index.ts", capability.adapter);
          await plugin.lifecycle.onFileStart("src/index.worker.ts", capability.adapter);
          await plugin.lifecycle.onFileStart("sw.ts", capability.adapter);
          await plugin.lifecycle.onFileStart("styles.less", capability.adapter);
          await plugin.lifecycle.onFileStart("styles.scss", capability.adapter);
          await plugin.lifecycle.onFileStart("styles.sass", capability.adapter);
          await plugin.lifecycle.onFileStart("styles.styl", capability.adapter);
          await plugin.lifecycle.onFileStart("module.tsrx", capability.adapter);
          await plugin.lifecycle.onFileStart("index.html", capability.adapter);
        }
        if (typeof plugin.lifecycle?.onASTNode === "function") {
          plugin.lifecycle.onASTNode(
            { type: "Program", body: [] },
            "src-index.ts",
            capability.adapter,
            [],
          );
          plugin.lifecycle.onASTNode(
            {
              type: "ExportNamedDeclaration",
              declaration: {
                type: "VariableDeclaration",
                declarations: [
                  {
                    type: "VariableDeclarator",
                    id: { type: "Identifier", name: "config" },
                    init: {
                      type: "ObjectExpression",
                      properties: [
                        {
                          type: "Property",
                          key: { type: "Identifier", name: "enabled" },
                          value: { type: "Literal", value: true },
                        },
                      ],
                    },
                  },
                ],
              },
            },
            "src-index.ts",
            capability.adapter,
            [],
          );
        }
        if (typeof plugin.lifecycle?.onAnalysisComplete === "function") {
          await plugin.lifecycle.onAnalysisComplete(capability.adapter);
        }
        if (
          !positiveDetected &&
          capability.usedFiles.size === 0 &&
          capability.usedPackages.size === 0 &&
          capability.findings.length === 0
        ) {
          failures.push(`${file}: positive fixture produced no observable capability result`);
        }
      } catch (error) {
        failures.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    expect(failures, failures.join("\n")).toEqual([]);
  });
});
