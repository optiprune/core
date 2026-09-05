import { access, readFile, readdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import fg from "fast-glob";
import path from "pathe";
import { describe, expect, it } from "vitest";

const fixturesRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/plugins/variants",
);
const pluginsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src/plugins");

function createAdapter(rootDir: string) {
  const resolve = (file: string) => (path.isAbsolute(file) ? file : path.resolve(rootDir, file));
  const usedFiles = new Set<string>();
  const usedPackages = new Set<string>();
  const findings: unknown[] = [];
  const adapter: any = {
    getConfig: () => ({ rootDir, entry: [], projectPatterns: [] }),
    readJson: async (file: string) => {
      try {
        return JSON.parse(await readFile(resolve(file), "utf8"));
      } catch {
        return null;
      }
    },
    readFile: async (file: string) => {
      try {
        return await readFile(resolve(file), "utf8");
      } catch {
        return null;
      }
    },
    folderExists: async (file: string) => {
      try {
        await access(resolve(file));
        return true;
      } catch {
        return false;
      }
    },
    fileExists: async (file: string) => {
      try {
        await access(resolve(file));
        return true;
      } catch {
        return false;
      }
    },
    findFiles: async (patterns: string[] | string[]) =>
      fg.sync(Array.isArray(patterns) ? patterns : [patterns], {
        cwd: rootDir,
        dot: true,
        onlyFiles: true,
      }),
    findFilesByGlob: async (patterns: string[] | string[]) =>
      fg.sync(Array.isArray(patterns) ? patterns : [patterns], {
        cwd: rootDir,
        dot: true,
        onlyFiles: true,
      }),
    markAsUsed: (file: string) => usedFiles.add(String(file)),
    markConfigFileAsUsed: (file: string) => usedFiles.add(String(file)),
    markPackageAsUsed: (pkg: string) => usedPackages.add(String(pkg)),
    emitFinding: (finding: unknown) => findings.push(finding),
    addEntryPatterns: () => undefined,
    addIgnorePatterns: () => undefined,
    addProjectPatterns: () => undefined,
    addUnreachableFileIgnorePatterns: () => undefined,
    setMonorepo: () => undefined,
    attachMetadata: () => undefined,
    isFileIgnored: async () => false,
    isFileUsed: () => false,
    getPackageInfo: async () => null,
    declareFramework: () => undefined,
    hasFramework: () => false,
    setRepoType: () => undefined,
    addProtectedExportPatterns: () => undefined,
  };
  return { adapter, usedFiles, usedPackages, findings };
}

describe("webpro-nl/knip plugin fixture variants", () => {
  it("executes every mapped fixture against its own plugin", async () => {
    const variants = (await readdir(fixturesRoot)).sort();
    const failures: string[] = [];
    let mappedCount = 0;

    for (const variant of variants) {
      const rootDir = path.join(fixturesRoot, variant);
      const metadata = JSON.parse(await readFile(path.join(rootDir, "variant.meta.json"), "utf8"));
      if (typeof metadata.plugin !== "string") continue;
      mappedCount += 1;
      const pluginFile = (await access(path.join(pluginsRoot, `${metadata.plugin}-plugin.ts`))
        .then(() => true)
        .catch(() => false))
        ? `${metadata.plugin}-plugin.ts`
        : `${metadata.plugin}.ts`;
      const module = await import(pathToFileURL(path.join(pluginsRoot, pluginFile)).href);
      const plugin =
        module.default ??
        Object.values(module).find((value: any) => value?.name?.endsWith("-plugin"));
      if (!plugin) {
        failures.push(`${variant}: missing ${metadata.plugin} plugin export`);
        continue;
      }
      const capability = createAdapter(rootDir);
      try {
        if (typeof plugin.detect === "function") {
          const detected = await plugin.detect(capability.adapter);
          if (typeof detected !== "boolean") {
            failures.push(`${variant}: ${metadata.plugin}.detect() returned ${String(detected)}`);
          }
        }
        if (typeof plugin.lifecycle?.onProjectInit === "function") {
          await plugin.lifecycle.onProjectInit(capability.adapter);
        }
      } catch (error) {
        failures.push(`${variant}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    expect(mappedCount).toBeGreaterThan(200);
    expect(failures, failures.join("\n")).toEqual([]);
  });
});
