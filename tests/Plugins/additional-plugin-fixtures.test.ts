import { describe, expect, it } from "vitest";
import { AvaPlugin } from "../../src/plugins/ava-plugin.js";
import { CypressPlugin } from "../../src/plugins/cypress-plugin.js";
import { WebpackPlugin } from "../../src/plugins/webpack-plugin.js";
import { RollupPlugin } from "../../src/plugins/rollup-plugin.js";
import { ESBuildPlugin } from "../../src/plugins/esbuild-plugin.js";
import { PrettierPlugin } from "../../src/plugins/prettier-plugin.js";
import { BiomePlugin } from "../../src/plugins/biome-plugin.js";
import { LessCompilerPlugin } from "../../src/plugins/less-compiler-plugin.js";
import { StylusCompilerPlugin } from "../../src/plugins/stylus-compiler-plugin.js";
import { ChangesetsPlugin } from "../../src/plugins/changesets-plugin.js";
import { HuskyPlugin } from "../../src/plugins/husky-plugin.js";
import { SimpleGitHooksPlugin } from "../../src/plugins/simple-git-hooks-plugin.js";
import { runPluginFixture } from "./fixture-utils.js";

const positiveCases = [
  ["coverage-ava", AvaPlugin],
  ["coverage-cypress", CypressPlugin],
  ["coverage-webpack", WebpackPlugin],
  ["coverage-rollup", RollupPlugin],
  ["coverage-esbuild", ESBuildPlugin],
  ["coverage-prettier", PrettierPlugin],
  ["coverage-biome", BiomePlugin],
  ["coverage-less", LessCompilerPlugin],
  ["coverage-stylus", StylusCompilerPlugin],
  ["coverage-changesets", ChangesetsPlugin],
  ["coverage-husky", HuskyPlugin],
  ["coverage-simple-git-hooks", SimpleGitHooksPlugin],
] as const;

describe("additional plugin positive fixtures", () => {
  it.each(positiveCases)("detects %s from realistic evidence", async (fixtureName, plugin) => {
    const result = await runPluginFixture(fixtureName, plugin);
    expect(result.detected).toBe(true);
  });
});

const negativeCases = [
  ["coverage-generic-tests", AvaPlugin],
  ["coverage-generic-tests", CypressPlugin],
  ["coverage-generic-tests", WebpackPlugin],
  ["coverage-generic-tests", RollupPlugin],
  ["coverage-generic-tests", ESBuildPlugin],
] as const;

describe("additional plugin negative fixtures", () => {
  it.each(negativeCases)(
    "does not activate %s from unrelated Node tests",
    async (fixtureName, plugin) => {
      const result = await runPluginFixture(fixtureName, plugin);
      expect(result.detected).toBe(false);
    },
  );
});
