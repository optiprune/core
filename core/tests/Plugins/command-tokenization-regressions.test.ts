import { describe, expect, it } from "vitest";
import { hasCommand, tokenizeCommand } from "../../src/plugin-utils.js";
import { BunPlugin } from "../../src/plugins/bun-plugin.js";
import { CapacitorPlugin } from "../../src/plugins/capacitor-plugin.js";
import { DockerPlugin } from "../../src/plugins/docker-plugin.js";
import { OxfmtPlugin } from "../../src/plugins/oxfmt-plugin.js";
import { PnpmPlugin } from "../../src/plugins/pnpm-plugin.js";
import { PreCommitPlugin } from "../../src/plugins/pre-commit-plugin.js";
import { SimpleGitHooksPlugin } from "../../src/plugins/simple-git-hooks-plugin.js";
import { TravisCiPlugin } from "../../src/plugins/travis-ci-plugin.js";
import { VitePlugin } from "../../src/plugins/vite-plugin.js";
import { VitepressPlugin } from "../../src/plugins/vitepress-plugin.js";
import { WireitPlugin } from "../../src/plugins/wireit-plugin.js";
import { YarnPlugin } from "../../src/plugins/yarn-plugin.js";

type FixtureOptions = {
  files?: Record<string, string>;
  packageJson?: Record<string, unknown>;
};

function fixture(options: FixtureOptions = {}) {
  const files = options.files ?? {};
  const usedFiles: string[] = [];
  const usedPackages: string[] = [];
  const findings: unknown[] = [];
  const adapter: any = {
    readJson: async (file: string) =>
      file === "package.json" ? (options.packageJson ?? {}) : null,
    readFile: async (file: string) => files[file] ?? null,
    folderExists: async (file: string) => Object.prototype.hasOwnProperty.call(files, file),
    fileExists: async (file: string) => Object.prototype.hasOwnProperty.call(files, file),
    findFilesByGlob: async () => Object.keys(files),
    markAsUsed: (file: string, detail?: string) =>
      usedFiles.push(detail ? `${file}:${detail}` : file),
    markRelativeFileAsUsed: (source: string, file: string) => usedFiles.push(`${source}:${file}`),
    markPackageAsUsed: (pkg: string) => usedPackages.push(pkg),
    markFilesByGlob: async () => undefined,
    setWorkspaceGlobs: () => undefined,
    setRepoType: () => undefined,
    setMonorepo: () => undefined,
    addProjectPatterns: () => undefined,
    addEntryPatterns: () => undefined,
    emitFinding: (finding: unknown) => findings.push(finding),
    getConfig: () => ({ rootDir: "/fixture" }),
  };
  return { adapter, usedFiles, usedPackages, findings };
}

describe("command tokenizer fixtures", () => {
  it.each([
    ["vite build", ["vite", "build"]],
    ['npm run "build:prod"', ["npm", "run", "build:prod"]],
    [
      "pnpm --filter @scope/app exec -- vite build",
      ["pnpm", "--filter", "@scope/app", "exec", "--", "vite", "build"],
    ],
    [
      "echo 'vite build' && npx --yes eslint .",
      ["echo", "vite build", "&&", "npx", "--yes", "eslint", "."],
    ],
    ["./node_modules/.bin/vitest run", ["./node_modules/.bin/vitest", "run"]],
  ])("tokenizes %s without losing command boundaries", (input, expected) => {
    expect(tokenizeCommand(input)).toEqual(expected);
  });

  it.each([
    ["vite build", ["vite"], true],
    ["npm exec -- vite build", ["vite"], true],
    ["pnpm dlx --yes semantic-release", ["semantic-release"], true],
    ["npx --yes eslint .", ["eslint"], true],
    ["bunx --bun oxfmt .", ["oxfmt"], true],
    ["echo vite", ["vite"], false],
    ["echo parcelship", ["parcel"], false],
    ["# npx eslint .", ["eslint"], false],
    ["node -e \"console.log('vite')\"", ["vite"], false],
    ["description: vite is used here", ["vite"], false],
    ["printf 'npx eslint .'", ["eslint"], false],
  ])("recognizes only an executable command in %s", (input, command, expected) => {
    expect(hasCommand(input, command)).toBe(expected);
  });
});

describe("package-script plugin fixtures", () => {
  it.each([
    [BunPlugin, { scripts: { build: "echo bunyan" } }, false],
    [BunPlugin, { scripts: { build: "bun run src/index.ts" } }, true],
    [PnpmPlugin, { scripts: { build: "echo pnpmish" } }, false],
    [PnpmPlugin, { scripts: { build: "pnpm --filter app build" } }, true],
    [YarnPlugin, { scripts: { build: "echo yarnish" } }, false],
    [YarnPlugin, { scripts: { build: "yarn workspaces foreach run build" } }, true],
    [VitePlugin, { scripts: { build: "echo vite build" } }, false],
    [VitePlugin, { scripts: { build: "npm exec -- vite build" } }, true],
    [VitepressPlugin, { scripts: { docs: "echo vitepress" } }, false],
    [VitepressPlugin, { scripts: { docs: "vitepress dev docs" } }, true],
    [OxfmtPlugin, { scripts: { format: "bunx --yes oxfmt ." } }, true],
  ] as const)(
    "detects real commands and rejects text mentions",
    async (plugin, packageJson, expected) => {
      const { adapter } = fixture({ packageJson });
      await expect(plugin.detect?.(adapter)).resolves.toBe(expected);
    },
  );

  it("does not treat an unrelated Capacitor mention as an npx invocation", async () => {
    const { adapter } = fixture({
      packageJson: { scripts: { build: "echo capacitor is documented" } },
    });
    await expect(CapacitorPlugin.detect?.(adapter)).resolves.toBe(false);
  });
});

describe("configuration and hook command fixtures", () => {
  it("extracts the package after npx options from a Dockerfile", async () => {
    const { adapter, usedPackages } = fixture({
      files: { Dockerfile: "FROM node:22\nRUN npx --yes prisma generate\n" },
    });
    await DockerPlugin.lifecycle?.onProjectInit?.(adapter);
    expect(usedPackages).toContain("prisma");
  });

  it("does not mark a Dockerfile comment or echo text as a package", async () => {
    const { adapter, usedPackages } = fixture({
      files: { Dockerfile: "FROM node:22\nRUN echo npx fake-package\n# RUN npx commented\n" },
    });
    await DockerPlugin.lifecycle?.onProjectInit?.(adapter);
    expect(usedPackages).not.toContain("fake-package");
    expect(usedPackages).not.toContain("commented");
  });

  it.each([
    [
      PreCommitPlugin,
      ".pre-commit-config.yaml",
      "repos:\n  - repo: local\n    hooks:\n      - id: lint\n        entry: npx --no-install eslint .\n",
      "eslint",
    ],
    [TravisCiPlugin, ".travis.yml", "script:\n  - npx --yes prettier .\n", "prettier"],
    [
      SimpleGitHooksPlugin,
      ".simple-git-hooks.json",
      '{"pre-commit": "pnpm exec -- lint-staged"}\n',
      "lint-staged",
    ],
    [WireitPlugin, "package.json", "", "eslint"],
  ] as const)("preserves package binaries in %s", async (plugin, file, content, pkg) => {
    const packageJson =
      plugin === WireitPlugin ? { wireit: { lint: { command: "npx --yes eslint ." } } } : {};
    const { adapter, usedPackages } = fixture({ files: { [file]: content }, packageJson });
    await plugin.lifecycle?.onProjectInit?.(adapter);
    expect(usedPackages).toContain(pkg);
  });

  it("extracts quoted npm scripts from pre-commit entries", async () => {
    const { adapter, usedFiles } = fixture({
      files: { ".pre-commit-config.yaml": 'entry: "npm run build:prod"\n' },
    });
    await PreCommitPlugin.lifecycle?.onProjectInit?.(adapter);
    expect(usedFiles).toContain("package.json:scripts:build:prod");
  });

  it("supports shell operators while ignoring command names in arguments", async () => {
    const { adapter, usedPackages } = fixture({
      files: { ".travis.yml": "script: echo vite && npx --yes eslint .\n" },
    });
    await TravisCiPlugin.lifecycle?.onProjectInit?.(adapter);
    expect(usedPackages).toContain("eslint");
    expect(usedPackages).not.toContain("vite");
  });
});
