import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PluginEngine } from "../../src/engine.js";
import type { AnalyzerPlugin } from "../../src/types.js";

describe("dynamic plugin registry", () => {
  it("contains only one Nodemon plugin source file", async () => {
    const pluginsDir = path.resolve(process.cwd(), "src/plugins");
    const nodemonFiles = (await fs.readdir(pluginsDir)).filter((file) =>
      /^nodemon-plugin\.(?:ts|js)$/.test(file),
    );

    expect(nodemonFiles).toEqual(["nodemon-plugin.ts"]);
  });

  it("does not register two plugins with the same name", () => {
    const engine = new PluginEngine();
    const first: AnalyzerPlugin = {
      name: "duplicate-test-plugin",
      version: "1.0.0",
      detect: async () => false,
      lifecycle: {},
    };
    const second: AnalyzerPlugin = {
      ...first,
      version: "2.0.0",
    };

    engine.register(first);
    engine.register(second);

    expect((engine as unknown as { plugins: AnalyzerPlugin[] }).plugins).toEqual(
      expect.arrayContaining([first]),
    );
    expect(
      (engine as unknown as { plugins: AnalyzerPlugin[] }).plugins.filter(
        (plugin) => plugin.name === "duplicate-test-plugin",
      ),
    ).toHaveLength(1);
  });
});
