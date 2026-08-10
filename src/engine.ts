import { AnalysisContext, ModuleRecord, AnalyzerPlugin, PluginAdapter, Finding } from "./types.js";
import { walkAst as yukuWalk } from "./parser.js";
import { t } from "./ast-utils.js";
import fs from "node:fs/promises";
import path from "pathe";
import { fileURLToPath, pathToFileURL } from "node:url";

export class PluginEngine {
  private plugins: AnalyzerPlugin[] = [];
  private findings: Finding[] = [];

  register(plugin: AnalyzerPlugin) {
    this.plugins.push(plugin);
  }

  async loadDynamicPlugins() {
    try {
      const __dirname = path.dirname(fileURLToPath(import.meta.url));
      const pluginsDir = path.join(__dirname, "plugins");
      
      let files: string[] = [];
      try {
        files = await fs.readdir(pluginsDir);
      } catch (e) {
        return;
      }

      for (const file of files) {
        if ((file.endsWith(".ts") || file.endsWith(".js")) && !file.endsWith(".d.ts")) {
          try {
            const pluginPath = pathToFileURL(path.join(pluginsDir, file)).href;
            const module = await import(pluginPath);
            const keys = Object.keys(module);
            const firstKey = keys[0];
            const plugin = module.default || (firstKey ? (module as any)[firstKey] : null);
            
            if (plugin && typeof plugin === "object" && plugin.name && plugin.lifecycle) {
              this.register(plugin);
            }
          } catch (err) {}
        }
      }
    } catch (err) {}
  }

  private isIgnored(fileId: string, ignorePatterns: string[]): boolean {
    if (!ignorePatterns || ignorePatterns.length === 0) return false;
    const normalized = fileId.replace(/\\/g, "/");
    return ignorePatterns.some((pattern) => {
      const cleanPattern = pattern.replace(/\\/g, "/");
      if (cleanPattern.startsWith("*")) {
        return normalized.endsWith(cleanPattern.slice(1));
      }
      return normalized.includes(cleanPattern);
    });
  }

  async run(context: AnalysisContext): Promise<Finding[]> {
    const adapter = this.createAdapter(context);
    await this.loadDynamicPlugins();

    // ── Plugin detection with config-driven overrides ──────────────────────
    //
    // `context.options.plugins` is a Record<pluginName, boolean> that can
    // force-enable or force-disable individual plugins regardless of what
    // their own `detect()` hook returns.
    //
    // Priority:
    //   1. If `plugins[name] === false`  → always disabled
    //   2. If `plugins[name] === true`   → always enabled
    //   3. Otherwise                     → run detect() as usual
    //
    const pluginOverrides: Record<string, boolean> = context.options.plugins ?? {};

    for (const plugin of this.plugins) {
      try {
        const override = pluginOverrides[plugin.name];

        if (override === false) {
          // Explicitly disabled by config – skip detection entirely.
          plugin.enabled = false;
        } else if (override === true) {
          // Explicitly enabled by config – skip detection entirely.
          plugin.enabled = true;
        } else if (plugin.detect) {
          plugin.enabled = await plugin.detect(adapter);
        } else {
          plugin.enabled = true;
        }

        if (plugin.enabled) {
          context.enabledPlugins?.add(plugin.name);
        }
      } catch (err) {
        plugin.enabled = false;
      }
    }

    for (const plugin of this.plugins) {
      if (plugin.enabled && plugin.lifecycle.onProjectInit) {
        try {
          await plugin.lifecycle.onProjectInit(adapter);
        } catch (err) {
          console.error(`[Plugin Engine] Error in onProjectInit for ${plugin.name}:`, err);
        }
      }
    }

    for (const module of context.modules.values()) {
      // Check ignore list resolved from options (including plugin config updates)
      if (this.isIgnored(module.id, context.options.ignore)) {
        continue;
      }

      if (!module.ast) continue;

      for (const plugin of this.plugins) {
        if (plugin.enabled && plugin.lifecycle.onFileStart) {
          try {
            await plugin.lifecycle.onFileStart(module.id, adapter);
          } catch (err) {
            console.error(`[Plugin Engine] Error in onFileStart for ${plugin.name} on ${module.id}:`, err);
          }
        }
      }

      try {
        yukuWalk(module.ast as any, (node: any) => {
          for (const plugin of this.plugins) {
            if (plugin.enabled && plugin.lifecycle.onASTNode) {
              try {
                plugin.lifecycle.onASTNode(node, module.id, adapter);
              } catch (err) {}
            }
          }
        });
      } catch (err) {
        console.error(`[Plugin Engine] Error during AST traversal for ${module.id}:`, err);
      }
    }

    for (const plugin of this.plugins) {
      if (plugin.enabled && plugin.lifecycle.onAnalysisComplete) {
        try {
          await plugin.lifecycle.onAnalysisComplete(adapter);
        } catch (err) {
          console.error(`[Plugin Engine] Error in onAnalysisComplete for ${plugin.name}:`, err);
        }
      }
    }

    return this.findings;
  }

  createAdapter(context: AnalysisContext): PluginAdapter {
    return {
      getAst: (fileId) => context.modules.get(fileId)?.ast,
      getSymbol: (name, fileId) => {
        const module = context.modules.get(fileId);
        return module?.exports.find(e => e.name === name || e.exportedAs === name);
      },
      getType: (node) => {
        if (t.isStringLiteral(node)) return 'string';
        if (t.isNumericLiteral(node)) return 'number';
        if (t.isBooleanLiteral(node)) return 'boolean';
        return undefined;
      },
      getDependencies: (fileId) => {
        const module = context.modules.get(fileId);
        return module?.edges.map(e => e.target).filter(Boolean) as string[] || [];
      },
      getConfig: () => context.options,
      readFile: async (filename) => {
        try {
          const fullPath = path.isAbsolute(filename) ? filename : path.join(context.options.rootDir, filename);
          return await fs.readFile(fullPath, 'utf8');
        } catch {
          return null;
        }
      },
      readJson: async (filename) => {
        try {
          const fullPath = path.isAbsolute(filename) ? filename : path.join(context.options.rootDir, filename);
          const content = await fs.readFile(fullPath, 'utf8');
          return JSON.parse(content);
        } catch {
          return null;
        }
      },
      folderExists: async (folderName) => {
        try {
          const fullPath = path.isAbsolute(folderName)
            ? folderName
            : path.join(context.options.rootDir, folderName);
          await fs.access(fullPath);
          return true;
        } catch {
          return false;
        }
      },
      emitFinding: (finding: Omit<Finding, "rule"> & { rule?: string }) => {
        this.findings.push({
          ...finding,
          rule: finding.rule ?? 'plugin-finding',
          confidence: finding.confidence ?? 'high',
          severity: finding.severity ?? 'warning',
        } as Finding);
      },
      markAsUsed: (fileId, symbol) => {
        context.reachable.add(fileId);
        if (symbol) {
          context.usedExports.add(`${fileId}:${symbol}`);
        }
      },
      markPackageAsUsed: (packageName) => {
        context.usedPackages?.add(packageName);
      },
      attachMetadata: (node, key, value) => {
        (node as any).metadata = (node as any).metadata || {};
        (node as any).metadata[key] = value;
      },
      setMonorepo: (monorepo) => {
        context.options.monorepo = monorepo;
        context.monorepo = monorepo;
      }
    };
  }
}
