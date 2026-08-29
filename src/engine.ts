import { AnalysisContext, ModuleRecord, AnalyzerPlugin, PluginAdapter, Finding } from "./types.js";
import { walkAst as yukuWalk } from "./parser.js";
import { t } from "./ast-utils.js";
import fs from "node:fs/promises";
import path from "pathe";
import { fileURLToPath, pathToFileURL } from "node:url";
import { compileGlobs, matchesAnyGlob } from "./fs-utils.js";
import { ObjectMemberPlugin } from "./plugins/object-member-plugin.js";

// ── Verbose debug helper ────────────────────────────────────────────────────
// All engine-level debug messages go to stderr so they never pollute JSON /
// SARIF output on stdout.  They are only emitted when `options.verbose` is
// true (same convention used by graph.ts).
function dbg(verbose: boolean | undefined, msg: string): void {
  if (verbose) console.error(msg);
}
function safeResolve(rootDir: string, targetPath: string): string | null {
  // Always resolve relative to rootDir
  const resolved = path.resolve(rootDir, targetPath);
  const relative = path.relative(rootDir, resolved);

  // If the path starts with '..' or points to a different root, it escaped rootDir
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }
  return resolved;
}
export class PluginEngine {
  private plugins: AnalyzerPlugin[] = [];
  private findings: Finding[] = [];

  constructor() {
    // Object-member analysis is a core correctness rule. Register it
    // explicitly so it cannot be disabled or lost when optional plugins are
    // discovered dynamically.
    this.register(ObjectMemberPlugin);
  }

  register(plugin: AnalyzerPlugin) {
    this.plugins.push(plugin);
  }

  async loadDynamicPlugins(context: AnalysisContext, registerPlugins = true) {
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
        if (file === "object-member-plugin.ts" || file === "object-member-plugin.js") continue;
        if ((file.endsWith(".ts") || file.endsWith(".js")) && !file.endsWith(".d.ts")) {
          try {
            const pluginPath = pathToFileURL(path.join(pluginsDir, file)).href;
            const module = await import(pluginPath);
            const keys = Object.keys(module);
            const firstKey = keys[0];
            const plugin = module.default || (firstKey ? (module as any)[firstKey] : null);

            if (plugin && typeof plugin === "object") {
              // These property reads are the real dynamic registry contract.
              // Forward the observed reads to the analysis graph rather than
              // suppressing object-member diagnostics by path or name.
              const pluginName = plugin.name;
              const pluginVersion = plugin.version;
              const pluginDetect = plugin.detect;
              const pluginLifecycle = plugin.lifecycle;
              if (pluginName && pluginLifecycle) {
                const stem = file.replace(/\.(?:[cm]?js|ts)$/i, "");
                const sourceModule = [...context.modules.values()].find((candidate) => {
                  const normalized = candidate.id.replace(/\\/g, "/");
                  return (
                    normalized.endsWith(`/src/plugins/${stem}.ts`) ||
                    normalized.endsWith(`/src/plugins/${stem}.js`) ||
                    normalized.endsWith(`/plugins/${stem}.ts`) ||
                    normalized.endsWith(`/plugins/${stem}.js`)
                  );
                });
                if (sourceModule && firstKey) {
                  for (const memberName of ["name", "version", "detect", "lifecycle"]) {
                    if (memberName === "version" && pluginVersion === undefined) continue;
                    if (memberName === "detect" && pluginDetect === undefined) continue;
                    if (memberName === "lifecycle" && pluginLifecycle === undefined) continue;
                    context.runtimeUsedMembers?.add(`${sourceModule.id}:${firstKey}:${memberName}`);
                    context.usedMembers.add(`${sourceModule.id}:${firstKey}:${memberName}`);
                  }
                }
                if (registerPlugins) this.register(plugin);
              }
            }
          } catch (err) {}
        }
      }
    } catch (err) {}
  }

  async run(
    context: AnalysisContext,
    runOptions: { skipDetection?: boolean } = {},
  ): Promise<Finding[]> {
    // Each pass owns its findings. The analyzer calls the engine twice: once for
    // early project configuration and once after source discovery. Keeping a
    // shared array makes the second pass re-return findings from the first pass.
    this.findings = [];

    const verbose = context.options?.verbose;
    const adapter = this.createAdapter(context);
    // Compile ignore globs once per engine pass instead of once per module.
    const compiledIgnorePatterns = compileGlobs(context.options?.ignore ?? []);

    if (!runOptions.skipDetection) {
      this.findings = [];
      await this.loadDynamicPlugins(context, true);

      // ── Engine Debug: registered plugins ───────────────────────────────────
      if (verbose) {
        dbg(verbose, `[Plugin Engine] ── Registered plugins (${this.plugins.length}) ──`);
        for (const plugin of this.plugins) {
          dbg(verbose, `  • ${plugin.name}@${plugin.version}`);
        }
      }
    } else {
      // The final execution pass runs after source discovery. Re-read the
      // dynamically imported registry here so runtime member observations can
      // be attached to the now-populated module graph without re-registering
      // plugin lifecycle handlers.
      await this.loadDynamicPlugins(context, false);
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
            dbg(
              verbose,
              `[Plugin Engine] ${plugin.name}: ${plugin.enabled ? "ENABLED" : "DISABLED"} (detect())`,
            );
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
        const enabled = this.plugins.filter((p) => p.enabled).map((p) => p.name);
        const disabled = this.plugins.filter((p) => !p.enabled).map((p) => p.name);
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
      if (matchesAnyGlob(module.id, compiledIgnorePatterns, context.options?.rootDir)) {
        continue;
      }

      if (!module.ast) continue;

      for (const plugin of this.plugins) {
        if (plugin.enabled && plugin.lifecycle.onFileStart) {
          try {
            await plugin.lifecycle.onFileStart(module.id, adapter);
          } catch (err) {
            console.error(
              `[Plugin Engine] Error in onFileStart for ${plugin.name} on ${module.id}:`,
              err,
            );
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
      dbg(
        verbose,
        `  context.enabledPlugins    : ${[...(context.enabledPlugins ?? [])].join(", ") || "(none)"}`,
      );
    }

    return this.findings;
  }

  createAdapter(context: AnalysisContext): PluginAdapter {
    let projectFiles: Promise<string[]> | undefined;
    const discoverProjectFiles = async (): Promise<string[]> => {
      if (!projectFiles) {
        projectFiles = (async () => {
          const ignoredDirectories = new Set([
            ".git",
            "node_modules",
            "dist",
            "build",
            "coverage",
            ".next",
            ".nuxt",
            ".svelte-kit",
            ...(context.options.ignoreTests
              ? ["test", "tests", "fixtures", "__tests__", "__mocks__"]
              : []),
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
                if (!ignoredDirectories.has(entry.name))
                  await visit(path.join(directory, entry.name));
                continue;
              }
              if (entry.isFile()) {
                files.push(
                  path
                    .relative(context.options.rootDir, path.join(directory, entry.name))
                    .replace(/\\/g, "/"),
                );
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
        return module?.exports.find((e) => e.name === name || e.exportedAs === name);
      },
      getType: (node) => {
        if (t.isStringLiteral(node)) return "string";
        if (t.isNumericLiteral(node)) return "number";
        if (t.isBooleanLiteral(node)) return "boolean";
        return undefined;
      },
      getDependencies: (fileId) => {
        const module = context.modules.get(fileId);
        return (module?.edges.map((e) => e.target).filter(Boolean) as string[]) || [];
      },
      isPublicExport: (fileId, exportName) => {
        const module = context.modules.get(fileId);
        const exportRecord = module?.exports.find(
          (exp) => exp.exportedAs === exportName || exp.name === exportName,
        );
        if (!exportRecord) return false;
        if (context.publicApiEntryPoints?.has(fileId)) return true;
        if (context.usedExportConfidence.get(`${fileId}:${exportRecord.exportedAs}`) === "low")
          return true;

        const visited = new Set<string>();
        const queue = Array.from(context.publicApiEntryPoints ?? [], (entry) => ({
          moduleId: entry,
          name: exportName,
        }));
        while (queue.length > 0) {
          const current = queue.shift()!;
          const visitKey = `${current.moduleId}:${current.name}`;
          if (visited.has(visitKey)) continue;
          visited.add(visitKey);
          if (current.moduleId === fileId && current.name === exportName) return true;
          const currentModule = context.modules.get(current.moduleId);
          if (!currentModule) continue;
          const currentExport = currentModule.exports.find(
            (exp) => exp.exportedAs === current.name || exp.name === current.name,
          );
          for (const edge of currentModule.edges) {
            const isReExportEdge = edge.kind === "export-all" || edge.kind === "export-from";
            const isLocalImportReExport =
              edge.kind === "import" &&
              currentExport &&
              (edge.importedNames.includes("*") || edge.importedNames.includes(current.name));
            if (!isReExportEdge && !isLocalImportReExport) continue;
            const targetIds = edge.target ? [edge.target] : [];
            for (const targetId of targetIds) {
              if (
                edge.kind === "export-all" ||
                edge.importedNames.includes("*") ||
                edge.importedNames.includes(current.name)
              ) {
                queue.push({ moduleId: targetId, name: current.name });
              }
            }
          }
        }
        return false;
      },
      isEntryPoint: (fileId) => {
        const absolutePath = path.isAbsolute(fileId)
          ? fileId
          : path.resolve(context.options.rootDir, fileId);
        return (
          (context.entryPoints?.has(absolutePath) ?? false) ||
          (context.publicApiEntryPoints?.has(absolutePath) ?? false)
        );
      },
      isDynamicallyImported: (fileId) => {
        const absolutePath = path.isAbsolute(fileId)
          ? fileId
          : path.resolve(context.options.rootDir, fileId);
        for (const module of context.modules.values()) {
          if (
            module.edges.some(
              (edge) =>
                edge.target === absolutePath &&
                (edge.kind === "dynamic-literal" ||
                  edge.kind === "dynamic-pattern" ||
                  edge.kind === "unknown-dynamic"),
            )
          ) {
            return true;
          }
        }
        return false;
      },
      getConfig: () => context.options,
      readFile: async (filename) => {
        const safePath = safeResolve(context.options.rootDir, filename);
        if (!safePath) return null;
        try {
          return await fs.readFile(safePath, "utf8");
        } catch {
          return null;
        }
      },
      readJson: async (filename) => {
        const safePath = safeResolve(context.options.rootDir, filename);
        if (!safePath) return null;
        try {
          const content = await fs.readFile(safePath, "utf8");
          return JSON.parse(content);
        } catch {
          return null;
        }
      },
      folderExists: async (folderName) => {
        const safePath = safeResolve(context.options.rootDir, folderName);
        if (!safePath) return false;
        try {
          await fs.access(safePath);
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
          rule: finding.rule ?? "plugin-finding",
          confidence: finding.confidence ?? "high",
          severity: finding.severity ?? "warning",
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
      markRelativeFileAsUsed: (sourceFileId, referencedPath) => {
        if (
          !referencedPath ||
          (!referencedPath.startsWith(".") && !referencedPath.startsWith("/"))
        ) {
          return;
        }
        const absolutePath = path.isAbsolute(referencedPath)
          ? referencedPath
          : path.resolve(path.dirname(sourceFileId), referencedPath);
        context.reachable?.add(absolutePath);
        context.runtimeUsedFiles?.add(absolutePath);
      },
      markConfigMemberAsUsed: (fileId, objectName, memberName) => {
        const absolutePath = path.isAbsolute(fileId)
          ? fileId
          : path.resolve(context.options.rootDir, fileId);
        context.semanticConfigMembers?.add(`${absolutePath}:${objectName}:${memberName}`);
      },
      isConfigMemberUsed: (fileId, objectName, memberName) => {
        const absolutePath = path.isAbsolute(fileId)
          ? fileId
          : path.resolve(context.options.rootDir, fileId);
        return (
          context.semanticConfigMembers?.has(`${absolutePath}:${objectName}:${memberName}`) ?? false
        );
      },
      markRuntimeMemberAsUsed: (fileId, objectName, memberName) => {
        const absolutePath = path.isAbsolute(fileId)
          ? fileId
          : path.resolve(context.options.rootDir, fileId);
        context.runtimeUsedMembers?.add(`${absolutePath}:${objectName}:${memberName}`);
      },
      isRuntimeMemberUsed: (fileId, objectName, memberName) => {
        const absolutePath = path.isAbsolute(fileId)
          ? fileId
          : path.resolve(context.options.rootDir, fileId);
        return (
          context.runtimeUsedMembers?.has(`${absolutePath}:${objectName}:${memberName}`) ?? false
        );
      },
      markPackageAsUsed: (packageName) => {
        context.usedPackages?.add(packageName);
      },
      markMissingDevDependency: (packageName, file, message) => {
        this.findings.push({
          rule: "missing-dev-dependency",
          severity: "error",
          confidence: "high",
          message:
            message ??
            `Package '${packageName}' is required by development tooling but is not declared in devDependencies.`,
          file,
          evidence: { package: packageName, type: "devDependency" },
        });
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
          .filter(
            (pattern): pattern is string =>
              typeof pattern === "string" && pattern.trim().length > 0,
          )
          .map((pattern) =>
            path.isAbsolute(pattern) ? pattern : path.resolve(context.options.rootDir, pattern),
          );
        context.options.entry = Array.from(new Set([...context.options.entry, ...normalized]));
        for (const entry of normalized) context.entryPoints?.add(entry);
      },
      addIgnorePatterns: (patterns) => {
        const validPatterns = patterns.filter(
          (pattern): pattern is string => typeof pattern === "string" && pattern.trim().length > 0,
        );
        context.options.ignore = Array.from(new Set([...context.options.ignore, ...validPatterns]));
      },
      addProjectPatterns: (patterns) => {
        const validPatterns = patterns.filter(
          (pattern): pattern is string => typeof pattern === "string" && pattern.trim().length > 0,
        );
        context.options.projectPatterns = Array.from(
          new Set([...(context.options.projectPatterns ?? []), ...validPatterns]),
        );
      },
      addUnreachableFileIgnorePatterns: (patterns) => {
        const validPatterns = patterns.filter(
          (pattern): pattern is string => typeof pattern === "string" && pattern.trim().length > 0,
        );
        context.options.unreachableFileIgnorePatterns = Array.from(
          new Set([...(context.options.unreachableFileIgnorePatterns ?? []), ...validPatterns]),
        );
      },
      addIgnoredDependencies: (names) => {
        const validNames = names.filter(
          (name): name is string => typeof name === "string" && name.trim().length > 0,
        );
        context.options.ignoreDependencies = Array.from(
          new Set([...context.options.ignoreDependencies, ...validNames]),
        );
      },
      addProtectedExportPatterns: (patterns) => {
        const validPatterns = patterns.filter(
          (pattern): pattern is string => typeof pattern === "string" && pattern.trim().length > 0,
        );
        context.options.protectedExportPatterns = Array.from(
          new Set([...(context.options.protectedExportPatterns ?? []), ...validPatterns]),
        );
      },
      addExternalContracts: (names) => {
        const validNames = names.filter(
          (name): name is string => typeof name === "string" && name.trim().length > 0,
        );
        context.options.externalContracts = Array.from(
          new Set([...context.options.externalContracts, ...validNames]),
        );
      },
      setWorkspaceGlobs: (patterns) => {
        const validPatterns = patterns.filter(
          (pattern): pattern is string => typeof pattern === "string" && pattern.trim().length > 0,
        );
        context.options.workspaceGlobs = Array.from(
          new Set([...(context.options.workspaceGlobs ?? []), ...validPatterns]),
        );
      },
      setRepoType: (type) => {
        context.options.repositoryType = type;
      },
      declareFramework: (name) => {
        if (typeof name !== "string" || name.trim().length === 0) return;
        context.options.frameworks = Array.from(
          new Set([...(context.options.frameworks ?? []), name]),
        );
      },
      hasFramework: (name) => context.options.frameworks?.includes(name) ?? false,
    };
  }
}
