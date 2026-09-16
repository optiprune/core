import { describe, it, expect, vi } from "vitest";
import { PluginEngine } from "../../src/engine.js";
import { AnalysisContext, AnalyzerPlugin } from "../../src/types.js";
import fs from "node:fs/promises";
import path from "pathe";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("Plugin Engine: Robust Loading & Execution", () => {
  it("should load plugins dynamically from src/plugins", async () => {
    const engine = new PluginEngine();
    const mockContext = {
      modules: new Map(),
      options: { rootDir: process.cwd() },
    } as unknown as AnalysisContext;

    // The Svelte and Angular plugins we just created should be loaded
    await engine.run(mockContext);

    // Accessing private plugins array via casting for verification
    const plugins = (engine as any).plugins as AnalyzerPlugin[];

    expect(plugins.some((p) => p.name === "svelte-plugin")).toBe(true);
    expect(plugins.some((p) => p.name === "angular-plugin")).toBe(true);
  });

  it("should catch errors in plugin lifecycle and continue", async () => {
    const engine = new PluginEngine();

    const buggyPlugin: AnalyzerPlugin = {
      name: "buggy-plugin",
      version: "1.0.0",
      lifecycle: {
        onProjectInit: () => {
          throw new Error("Boom!");
        },
      },
    };

    engine.register(buggyPlugin);

    const mockContext = {
      modules: new Map([
        ["test.js", { id: "test.js", ast: { type: "File", program: { body: [] } } }],
      ]),
      options: { rootDir: process.cwd() },
    } as unknown as AnalysisContext;

    // Should not throw
    await expect(engine.run(mockContext)).resolves.toBeDefined();
  });
});
