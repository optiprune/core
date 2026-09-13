import { describe, expect, it } from "vitest";
import { JestPlugin } from "../../src/plugins/jest-plugin.js";
import { VitestPlugin } from "../../src/plugins/vitest-plugin.js";
import { PlaywrightPlugin } from "../../src/plugins/playwright-plugin.js";
import { VitePlugin } from "../../src/plugins/vite-plugin.js";
import { EslintPlugin } from "../../src/plugins/eslint-plugin.js";
import { PnpmPlugin } from "../../src/plugins/pnpm-plugin.js";
import { YarnPnpPlugin } from "../../src/plugins/yarn-pnp-plugin.js";
import { SassCompilerPlugin } from "../../src/plugins/sass-compiler-plugin.js";
import { PackageCatalogPlugin } from "../../src/plugins/package-catalog-plugin.js";
import { WireitPlugin } from "../../src/plugins/wireit-plugin.js";
import { NycPlugin } from "../../src/plugins/nyc-plugin.js";
import { MochaPlugin } from "../../src/plugins/mocha-plugin.js";
import { runPluginFixture } from "./fixture-utils.js";

const positiveCases = [
  ["release-critical-jest", JestPlugin],
  ["release-critical-vitest", VitestPlugin],
  ["release-critical-playwright", PlaywrightPlugin],
  ["release-critical-vite", VitePlugin],
  ["release-critical-eslint", EslintPlugin],
  ["release-critical-pnpm", PnpmPlugin],
  ["release-critical-yarn-pnp", YarnPnpPlugin],
  ["release-critical-sass", SassCompilerPlugin],
] as const;

describe("release-critical positive fixtures", () => {
  it.each(positiveCases)("detects %s from explicit evidence", async (fixtureName, plugin) => {
    const result = await runPluginFixture(fixtureName, plugin);
    expect(result.detected).toBe(true);
  });
});

const negativeCases = [
  ["release-critical-node-tests", JestPlugin],
  ["release-critical-node-tests", VitestPlugin],
  ["release-critical-node-tests", MochaPlugin],
  ["release-critical-static-html", VitePlugin],
  ["release-critical-yarn-node-modules", YarnPnpPlugin],
  ["release-critical-pnpm-npmrc", PnpmPlugin],
  ["release-critical-no-catalog", PackageCatalogPlugin],
  ["release-critical-wireit-declared", WireitPlugin],
  ["release-critical-nyc-declared", NycPlugin],
  ["release-critical-playwright-declared", PlaywrightPlugin],
] as const;

describe("release-critical negative fixtures", () => {
  it.each(negativeCases)("does not activate %s falsely", async (fixtureName, plugin) => {
    const result = await runPluginFixture(fixtureName, plugin);
    expect(result.detected).toBe(false);
  });
});
