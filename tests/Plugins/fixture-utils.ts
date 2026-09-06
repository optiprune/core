import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_CONFIG } from "../../src/config-loader.js";
import { PluginEngine } from "../../src/engine.js";
import { contextWithGraph } from "../../src/graph.js";
import type { AnalyzerPlugin } from "../../src/types.js";

const fixtureRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/plugins",
);

export async function runPluginFixture(name: string, plugin: AnalyzerPlugin) {
  const rootDir = path.join(fixtureRoot, name);
  const context = contextWithGraph(new Map(), new Set(), {
    ...DEFAULT_CONFIG,
    rootDir,
    configFiles: [],
    ignoreTests: false,
  });
  const adapter = new PluginEngine().createAdapter(context);
  const detected = await plugin.detect?.(adapter);
  await plugin.lifecycle.onProjectInit?.(adapter);
  return { context, detected };
}
