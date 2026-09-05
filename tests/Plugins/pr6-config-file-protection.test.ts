import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../../src/config-loader.js";
import { PluginEngine } from "../../src/engine.js";
import { contextWithGraph } from "../../src/graph.js";
import { normalizeCanonicalPath } from "../../src/fs-utils.js";
import { BorpPlugin } from "../../src/plugins/borp-plugin.js";
import { CommitizenPlugin } from "../../src/plugins/commitizen-plugin.js";
import { CreateTypescriptAppPlugin } from "../../src/plugins/create-typescript-app-plugin.js";
import { DangerPlugin } from "../../src/plugins/danger-plugin.js";
import { EvePlugin } from "../../src/plugins/eve-plugin.js";
import { GithubActionPlugin } from "../../src/plugins/github-action-plugin.js";
import { LinthtmlPlugin } from "../../src/plugins/linthtml-plugin.js";
import { LunariaPlugin } from "../../src/plugins/lunaria-plugin.js";
import { MarkdownlintPlugin } from "../../src/plugins/markdownlint-plugin.js";
import { NanoSpawnPlugin } from "../../src/plugins/nano-spawn-plugin.js";
import { NanoStagedPlugin } from "../../src/plugins/nano-staged-plugin.js";
import { NestPlugin } from "../../src/plugins/nest-plugin.js";
import { NodeTestRunnerNubPlugin } from "../../src/plugins/node-test-runner-nub-plugin.js";
import { NodemonPlugin } from "../../src/plugins/nodemon-plugin.js";
import { PinoPlugin } from "../../src/plugins/pino-plugin.js";
import { RelayPlugin } from "../../src/plugins/relay-plugin.js";
import { SyncpackPlugin } from "../../src/plugins/syncpack-plugin.js";
import { TsdPlugin } from "../../src/plugins/tsd-plugin.js";
import { TypescriptPlugin } from "../../src/plugins/typescript-plugin.js";
import { WorkflowPlugin } from "../../src/plugins/workflow-plugin.js";
import { WxtPlugin } from "../../src/plugins/wxt-plugin.js";
import type { AnalyzerPlugin } from "../../src/types.js";

const fixtureRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/package-plugin-config-files",
);

const cases: Array<{
  name: string;
  plugin: AnalyzerPlugin;
  fixture: string;
  configFile: string;
  packageName?: string;
}> = [
  { name: "borp", plugin: BorpPlugin, fixture: "borp", configFile: ".borp.yml" },
  {
    name: "commitizen",
    plugin: CommitizenPlugin,
    fixture: "commitizen",
    configFile: ".czrc",
    packageName: "commitizen",
  },
  {
    name: "create-typescript-app",
    plugin: CreateTypescriptAppPlugin,
    fixture: "create-typescript-app",
    configFile: "create-typescript-app.config.ts",
    packageName: "create-typescript-app",
  },
  {
    name: "danger",
    plugin: DangerPlugin,
    fixture: "danger",
    configFile: "dangerfile.ts",
    packageName: "danger",
  },
  {
    name: "eve",
    plugin: EvePlugin,
    fixture: "eve",
    configFile: "eve.config.ts",
    packageName: "eve",
  },
  {
    name: "github-action",
    plugin: GithubActionPlugin,
    fixture: "github-action",
    configFile: ".github/workflows/ci.yml",
    packageName: "github-action",
  },
  {
    name: "linthtml",
    plugin: LinthtmlPlugin,
    fixture: "linthtml",
    configFile: "linthtml.config.js",
    packageName: "linthtml",
  },
  {
    name: "lunaria",
    plugin: LunariaPlugin,
    fixture: "lunaria",
    configFile: "lunaria.config.ts",
    packageName: "lunaria",
  },
  {
    name: "markdownlint",
    plugin: MarkdownlintPlugin,
    fixture: "markdownlint",
    configFile: ".markdownlint.yaml",
    packageName: "markdownlint",
  },
  {
    name: "nano-spawn",
    plugin: NanoSpawnPlugin,
    fixture: "nano-spawn",
    configFile: "nano-spawn.config.ts",
    packageName: "nano-spawn",
  },
  {
    name: "nano-staged",
    plugin: NanoStagedPlugin,
    fixture: "nano-staged",
    configFile: ".nano-staged.yaml",
    packageName: "nano-staged",
  },
  {
    name: "nest",
    plugin: NestPlugin,
    fixture: "nest",
    configFile: "nest-cli.json",
    packageName: "nest",
  },
  {
    name: "node-test-runner-nub",
    plugin: NodeTestRunnerNubPlugin,
    fixture: "node-test-runner-nub",
    configFile: "node-test-runner-nub.config.ts",
    packageName: "node-test-runner-nub",
  },
  {
    name: "nodemon",
    plugin: NodemonPlugin,
    fixture: "nodemon",
    configFile: "nodemon.json",
    packageName: "nodemon",
  },
  {
    name: "pino",
    plugin: PinoPlugin,
    fixture: "pino",
    configFile: "pino.config.ts",
    packageName: "pino",
  },
  {
    name: "relay",
    plugin: RelayPlugin,
    fixture: "relay",
    configFile: "relay.config.js",
    packageName: "relay",
  },
  {
    name: "syncpack",
    plugin: SyncpackPlugin,
    fixture: "syncpack",
    configFile: "syncpack.config.json",
    packageName: "syncpack",
  },
  { name: "tsd", plugin: TsdPlugin, fixture: "tsd", configFile: "tsd.json", packageName: "tsd" },
  {
    name: "typescript",
    plugin: TypescriptPlugin,
    fixture: "typescript",
    configFile: "tsconfig.json",
    packageName: "typescript",
  },
  {
    name: "workflow",
    plugin: WorkflowPlugin,
    fixture: "workflow",
    configFile: "workflow.config.ts",
    packageName: "workflow",
  },
  {
    name: "wxt",
    plugin: WxtPlugin,
    fixture: "wxt",
    configFile: "wxt.config.ts",
    packageName: "wxt",
  },
];

describe("PR #6 package-plugin config file protection", () => {
  it.each(cases)(
    "recognizes and protects the $name configuration fixture",
    async ({ plugin, fixture, configFile, packageName }) => {
      const rootDir = path.join(fixtureRoot, fixture);
      const configPath = normalizeCanonicalPath(path.join(rootDir, configFile));
      const context = contextWithGraph(new Map(), new Set(), {
        ...DEFAULT_CONFIG,
        rootDir,
        configFiles: [],
      });
      const engine = new PluginEngine();
      const adapter = engine.createAdapter(context);

      await expect(plugin.detect?.(adapter)).resolves.toBe(true);
      await plugin.lifecycle.onProjectInit?.(adapter);

      expect(context.protectedConfigFiles).toContain(configPath);
      expect(context.options.configFiles).toContain(configPath);
      expect(context.entryPoints).not.toContain(configPath);
      expect(context.reachable).not.toContain(configPath);
      expect(context.runtimeUsedFiles).not.toContain(configPath);
      if (packageName) expect(context.usedPackages).toContain(packageName);
    },
  );
});
