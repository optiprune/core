import { AnalysisContext, ModuleRecord, AnalyzerPlugin, PluginAdapter, Finding } from "./types.js";
import { walkAst as yukuWalk } from "./parser.js";
import { t } from "./ast-utils.js";
import fs from "node:fs/promises";
import path from "pathe";
import { fileURLToPath, pathToFileURL } from "node:url";
import { compileGlobs, isIgnored, matchesAnyGlob } from "./fs-utils.js";

// ── Verbose debug helper ────────────────────────────────────────────────────
// All engine-level debug messages go to stderr so they never pollute JSON /
// SARIF output on stdout.  They are only emitted when `options.verbose` is
// true (same convention used by graph.ts).
function dbg(verbose: boolean | undefined, msg: string): void {
  if (verbose) console.error(msg);
}

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
        files = (await fs.readdir(pluginsDir)).sort((left, right) => left.localeCompare(right));
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

  async run(context: AnalysisContext, runOptions: { skipDetection?: boolean } = {}): Promise<Finding[]> {
    // Each pass owns its findings. The analyzer calls the engine twice: once for
    // early project configuration and once after source discovery. Keeping a
    // shared array makes the second pass re-return findings from the first pass.
    this.findings = [];

    const verbose = context.options?.verbose;
    const adapter = this.createAdapter(context);
    
    if (!runOptions.skipDetection) {
      this.findings = [];
      await this.loadDynamicPlugins();

      // ── Engine Debug: registered plugins ───────────────────────────────────
      if (verbose) {
        dbg(verbose, `[Plugin Engine] ── Registered plugins (${this.plugins.length}) ──`);
        for (const plugin of this.plugins) {
          dbg(verbose, `  • ${plugin.name}@${plugin.version}`);
        }
      }
    }

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
    if (!runOptions.skipDetection) {
      const pluginOverrides: Record<string, boolean> = context.options?.plugins ?? {};

      for (const plugin of this.plugins) {
        try {
          const override = pluginOverrides[plugin.name];

          if (override === false) {
            // Explicitly disabled by config – skip detection entirely.
            plugin.enabled = false;
            dbg(verbose, `[Plugin Engine] ${plugin.name}: DISABLED (config override)`);
          } else if (override === true) {
            // Explicitly enabled by config – skip detection entirely.
            plugin.enabled = true;
            dbg(verbose, `[Plugin Engine] ${plugin.name}: ENABLED (config override)`);
          } else if (plugin.detect) {
            plugin.enabled = await plugin.detect(adapter);
            dbg(verbose, `[Plugin Engine] ${plugin.name}: ${plugin.enabled ? "ENABLED" : "DISABLED"} (detect())`);
          } else {
            plugin.enabled = true;
            dbg(verbose, `[Plugin Engine] ${plugin.name}: ENABLED (no detect hook)`);
          }

          if (plugin.enabled) {
            context.enabledPlugins?.add(plugin.name);
          }
        } catch (err) {
          plugin.enabled = false;
          dbg(verbose, `[Plugin Engine] ${plugin.name}: DISABLED (detect() threw: ${err})`);
        }
      }

      // ── Engine Debug: enabled plugins summary ──────────────────────────────
      if (verbose) {
        const enabled = this.plugins.filter(p => p.enabled).map(p => p.name);
        const disabled = this.plugins.filter(p => !p.enabled).map(p => p.name);
        dbg(verbose, `[Plugin Engine] ── Detection complete ──`);
        dbg(verbose, `  Enabled  (${enabled.length}): ${enabled.join(", ") || "(none)"}`);
        dbg(verbose, `  Disabled (${disabled.length}): ${disabled.join(", ") || "(none)"}`);
      }
    }

    for (const plugin of this.plugins) {
      if (plugin.enabled && plugin.lifecycle.onProjectInit && !runOptions.skipDetection) {
        try {
          if (!runOptions.skipDetection) {
            dbg(verbose, `[Plugin Engine] Running onProjectInit for ${plugin.name}`);
          }
          await plugin.lifecycle.onProjectInit(adapter);
        } catch (err) {
          console.error(`[Plugin Engine] Error in onProjectInit for ${plugin.name}:`, err);
        }
      }
    }

    for (const module of context.modules.values()) {
      // Check ignore list resolved from options (including plugin config updates)
      if (isIgnored(module.id, context.options?.ignore, context.options?.rootDir)) {
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
        yukuWalk(module.ast as any, (node: any, ancestors: any[]) => {
          for (const plugin of this.plugins) {
            if (plugin.enabled && plugin.lifecycle.onASTNode) {
              try {
                plugin.lifecycle.onASTNode(node, module.id, adapter, ancestors);
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
          if (!runOptions.skipDetection) {
            dbg(verbose, `[Plugin Engine] Running onAnalysisComplete for ${plugin.name}`);
          }
          await plugin.lifecycle.onAnalysisComplete(adapter);
        } catch (err) {
          console.error(`[Plugin Engine] Error in onAnalysisComplete for ${plugin.name}:`, err);
        }
      }
    }

    // ── Engine Debug: final reachability marks ─────────────────────────────
    if (verbose) {
      dbg(verbose, `[Plugin Engine] ── Post-run state ──`);
      dbg(verbose, `  context.reachable size    : ${context.reachable?.size ?? 0}`);
      dbg(verbose, `  context.usedPackages size : ${context.usedPackages?.size ?? 0}`);
      dbg(verbose, `  context.enabledPlugins    : ${[...(context.enabledPlugins ?? [])].join(", ") || "(none)"}`);
    }

    return this.findings;
  }

  createAdapter(context: AnalysisContext): PluginAdapter {
    let projectFiles: Promise<string[]> | undefined;
    const discoverProjectFiles = async (): Promise<string[]> => {
      if (!projectFiles) {
        projectFiles = (async () => {
          const ignoredDirectories = new Set([
            ".git", "node_modules", "dist", "build", "coverage", ".next", ".nuxt", ".svelte-kit",
          ]);
          const files: string[] = [];
          const visit = async (directory: string): Promise<void> => {
            let entries;
            try {
              entries = await fs.readdir(directory, { withFileTypes: true });
            } catch {
              return;
            }
            for (const entry of entries) {
              if (entry.isDirectory()) {
                if (!ignoredDirectories.has(entry.name)) await visit(path.join(directory, entry.name));
                continue;
              }
              if (entry.isFile()) {
                files.push(path.relative(context.options.rootDir, path.join(directory, entry.name)).replace(/\\/g, "/"));
              }
            }
          };
          await visit(context.options.rootDir);
          return files.sort((left, right) => left.localeCompare(right));
        })();
      }
      return projectFiles;
    };
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
      isPublicExport: (fileId, exportName) => {
        const module = context.modules.get(fileId);
        const exportRecord = module?.exports.find((exp) => exp.exportedAs === exportName || exp.name === exportName);
        if (!exportRecord) return false;
        if (context.publicApiEntryPoints?.has(fileId)) return true;
        if (context.usedExportConfidence.get(`${fileId}:${exportRecord.exportedAs}`) === "low") return true;

        const visited = new Set<string>();
        const queue = Array.from(context.publicApiEntryPoints ?? [], (entry) => ({ moduleId: entry, name: exportName }));
        while (queue.length > 0) {
          const current = queue.shift()!;
          const visitKey = `${current.moduleId}:${current.name}`;
          if (visited.has(visitKey)) continue;
          visited.add(visitKey);
          if (current.moduleId === fileId && current.name === exportName) return true;
          const currentModule = context.modules.get(current.moduleId);
          if (!currentModule) continue;
          const currentExport = currentModule.exports.find((exp) => exp.exportedAs === current.name || exp.name === current.name);
          for (const edge of currentModule.edges) {
            const isReExportEdge = edge.kind === "export-all" || edge.kind === "export-from";
            const isLocalImportReExport = edge.kind === "import" && currentExport &&
              (edge.importedNames.includes("*") || edge.importedNames.includes(current.name));
            if (!isReExportEdge && !isLocalImportReExport) continue;
            const targetIds = edge.target ? [edge.target] : [];
            for (const targetId of targetIds) {
              if (edge.kind === "export-all" || edge.importedNames.includes("*") || edge.importedNames.includes(current.name)) {
                queue.push({ moduleId: targetId, name: current.name });
              }
            }
          }
        }
        return false;
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
      findFiles: async (fileNames) => {
        const names = new Set(fileNames);
        return (await discoverProjectFiles()).filter((file) => names.has(path.basename(file)));
      },
      findFilesByGlob: async (patterns) => {
        const matchers = compileGlobs(patterns);
        return (await discoverProjectFiles()).filter((file) => matchesAnyGlob(file, matchers));
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
        const absolutePath = path.isAbsolute(fileId)
          ? fileId
          : path.resolve(context.options.rootDir, fileId);
        context.reachable?.add(absolutePath);
        context.runtimeUsedFiles?.add(absolutePath);
        if (symbol) {
          context.usedExports?.add(`${absolutePath}:${symbol}`);
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
      },
      addEntryPatterns: (patterns) => {
        const normalized = patterns
          .filter((pattern): pattern is string => typeof pattern === "string" && pattern.trim().length > 0)
          .map((pattern) => path.isAbsolute(pattern) ? pattern : path.resolve(context.options.rootDir, pattern));
        context.options.entry = Array.from(new Set([...context.options.entry, ...normalized]));
      },
      addIgnorePatterns: (patterns) => {
        const validPatterns = patterns.filter((pattern): pattern is string => typeof pattern === "string" && pattern.trim().length > 0);
        context.options.ignore = Array.from(new Set([...context.options.ignore, ...validPatterns]));
      },
      addProjectPatterns: (patterns) => {
        const validPatterns = patterns.filter((pattern): pattern is string => typeof pattern === "string" && pattern.trim().length > 0);
        context.options.projectPatterns = Array.from(new Set([...(context.options.projectPatterns ?? []), ...validPatterns]));
      },
      addUnreachableFileIgnorePatterns: (patterns) => {
        const validPatterns = patterns.filter((pattern): pattern is string => typeof pattern === "string" && pattern.trim().length > 0);
        context.options.unreachableFileIgnorePatterns = Array.from(new Set([
          ...(context.options.unreachableFileIgnorePatterns ?? []),
          ...validPatterns,
        ]));
      },
      addIgnoredDependencies: (names) => {
        const validNames = names.filter((name): name is string => typeof name === "string" && name.trim().length > 0);
        context.options.ignoreDependencies = Array.from(new Set([...context.options.ignoreDependencies, ...validNames]));
      },
      addProtectedExportPatterns: (patterns) => {
        const validPatterns = patterns.filter((pattern): pattern is string => typeof pattern === "string" && pattern.trim().length > 0);
        context.options.protectedExportPatterns = Array.from(new Set([
          ...(context.options.protectedExportPatterns ?? []),
          ...validPatterns,
        ]));
      },
      addExternalContracts: (names) => {
        const validNames = names.filter((name): name is string => typeof name === "string" && name.trim().length > 0);
        context.options.externalContracts = Array.from(new Set([...context.options.externalContracts, ...validNames]));
      },
      setWorkspaceGlobs: (patterns) => {
        const validPatterns = patterns.filter((pattern): pattern is string => typeof pattern === "string" && pattern.trim().length > 0);
        context.options.workspaceGlobs = Array.from(new Set([...(context.options.workspaceGlobs ?? []), ...validPatterns]));
      },
      setRepoType: (type) => {
        context.options.repositoryType = type;
      },
      declareFramework: (name) => {
        if (typeof name !== "string" || name.trim().length === 0) return;
        context.options.frameworks = Array.from(new Set([...(context.options.frameworks ?? []), name]));
      },
      hasFramework: (name) => context.options.frameworks?.includes(name) ?? false
    };
  }
}
