import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolvePackagePluginName } from "./helpers.js";

const pluginDirectory = path.resolve(process.cwd(), "src/plugins");
const testDirectory = path.resolve(process.cwd(), "tests/Plugins");

function pluginFile(name: string): string {
  return path.join(pluginDirectory, `${name}-plugin.ts`);
}

describe("plugin naming contract", () => {
  it("does not duplicate a base plugin with a numbered filename", () => {
    const pluginStems = readdirSync(pluginDirectory)
      .filter((file) => file.endsWith("-plugin.ts"))
      .map((file) => file.slice(0, -"-plugin.ts".length));

    for (const stem of pluginStems) {
      const base = stem.replace(/(?:-\d+|\d+)$/, "");
      if (base !== stem && pluginStems.includes(base)) {
        throw new Error(`Use ${base}-plugin.ts instead of duplicate ${stem}-plugin.ts`);
      }
    }
  });

  it("resolves all numbered test variants to a package plugin", () => {
    const testFiles = readdirSync(testDirectory).filter((file) => file.endsWith(".test.ts"));
    for (const file of testFiles) {
      const testName = file.slice(0, -".test.ts".length);
      const resolved = resolvePackagePluginName(testName);
      const isVariant = /(?:-\d+|\d+)$/.test(testName);
      if (isVariant) {
        expect(existsSync(pluginFile(resolved)), `${file} -> ${resolved}-plugin.ts`).toBe(true);
      }
    }
  });
});
