import { describe, expect, it } from "vitest";
import { CommitizenPlugin } from "../../src/plugins/commitizen-plugin.js";
import { CspellPlugin } from "../../src/plugins/cspell-plugin.js";
import { PostCSSPlugin } from "../../src/plugins/postcss-plugin.js";
import { SemanticReleasePlugin } from "../../src/plugins/semantic-release-plugin.js";
import { StrykerPlugin } from "../../src/plugins/stryker-plugin.js";
import { TsconfigPlusPlugin } from "../../src/plugins/tsconfig-plus-plugin.js";

type MockOptions = {
  files?: Record<string, string>;
  packageJson?: Record<string, unknown>;
};

function mockAdapter(options: MockOptions = {}) {
  const files = options.files ?? {};
  const usedFiles: string[] = [];
  const usedPackages: string[] = [];
  const findings: any[] = [];
  const adapter: any = {
    readJson: async (file: string) =>
      file === "package.json" ? (options.packageJson ?? null) : null,
    readFile: async (file: string) => files[file] ?? null,
    folderExists: async (file: string) => Object.prototype.hasOwnProperty.call(files, file),
    fileExists: async (file: string) => Object.prototype.hasOwnProperty.call(files, file),
    findFiles: async (names: string[]) => Object.keys(files).filter((file) => names.includes(file)),
    findFilesByGlob: async (patterns: string[]) => {
      const regexes = patterns.map(
        (pattern) =>
          new RegExp(
            `^${pattern
              .replace(/[.+^${}()|[\]\\]/g, "\\$&")
              .replace(/\*\*\/|\*\/|\*|\{yml,yaml\}/g, (token) =>
                token === "{yml,yaml}" ? "(?:yml|yaml)" : token.includes("**") ? ".*" : "[^/]*",
              )}$`,
          ),
      );
      return Object.keys(files).filter((file) => regexes.some((regex) => regex.test(file)));
    },
    markAsUsed: (file: string) => usedFiles.push(file),
    markRelativeFileAsUsed: (source: string, file: string) => usedFiles.push(`${source}:${file}`),
    markPackageAsUsed: (pkg: string) => usedPackages.push(pkg),
    addProjectPatterns: () => undefined,
    addEntryPatterns: () => undefined,
    emitFinding: (finding: any) => findings.push(finding),
    getConfig: () => ({ rootDir: "/fixture" }),
  };
  return { adapter, usedFiles, usedPackages, findings };
}

describe("plugin-specific reliability regressions", () => {
  it("keeps CSpell YAML dictionaries and imports reachable relative to the config", async () => {
    const { adapter, usedFiles, usedPackages } = mockAdapter({
      files: {
        ".cspell.yaml":
          "dictionaryDefinitions:\n  - path: ./config/words.txt\nimports:\n  - ./config/shared.json\n  - '@cspell/dict-typescript'\n",
      },
      packageJson: { devDependencies: { cspell: "latest" } },
    });
    await CspellPlugin.lifecycle?.onProjectInit?.(adapter);
    expect(usedFiles).toContain(".cspell.yaml");
    expect(usedFiles).toContain("cspell.json:./config/words.txt");
    expect(usedPackages).toContain("@cspell/dict-typescript");
  });

  it("parses PostCSS YAML plugin maps", async () => {
    const { adapter, usedPackages } = mockAdapter({
      files: { ".postcssrc.yaml": "plugins:\n  postcss-nested: {}\n  autoprefixer: {}\n" },
      packageJson: { devDependencies: { postcss: "latest" } },
    });
    await PostCSSPlugin.lifecycle?.onProjectInit?.(adapter);
    expect(usedPackages).toEqual(expect.arrayContaining(["postcss-nested", "autoprefixer"]));
  });

  it("parses Semantic Release YAML plugin arrays", async () => {
    const { adapter, usedPackages } = mockAdapter({
      files: {
        ".releaserc.yml":
          "plugins:\n  - '@semantic-release/commit-analyzer'\n  - '@semantic-release/npm'\n",
      },
      packageJson: { devDependencies: { "semantic-release": "latest" } },
    });
    await SemanticReleasePlugin.lifecycle?.onProjectInit?.(adapter);
    expect(usedPackages).toEqual(
      expect.arrayContaining(["@semantic-release/commit-analyzer", "@semantic-release/npm"]),
    );
  });

  it("uses glob discovery for Commitizen hooks and workflows", async () => {
    const { adapter } = mockAdapter({
      files: {
        ".husky/commit-msg": "pnpm exec cz",
        ".github/workflows/release.yml": "run: pnpm exec cz",
      },
      packageJson: {},
    });
    await expect(CommitizenPlugin.detect?.(adapter)).resolves.toBe(true);
  });

  it("does not classify an unrelated stryker substring as a CLI invocation", async () => {
    const { adapter } = mockAdapter({
      packageJson: { scripts: { build: "echo strykerish" } },
    });
    await expect(StrykerPlugin.detect?.(adapter)).resolves.toBe(false);
  });

  it("discovers custom tsconfig files instead of only default names", async () => {
    const { adapter, usedFiles } = mockAdapter({
      files: { "tsconfig.custom.json": '{ "include": ["src/**/*.ts"] }' },
      packageJson: { devDependencies: { typescript: "latest" } },
    });
    await TsconfigPlusPlugin.lifecycle?.onProjectInit?.(adapter);
    expect(usedFiles).toContain("tsconfig.custom.json");
  });
});
