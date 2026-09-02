import fs from "node:fs";
import path from "pathe";
import { parseWithYukuBackend } from "./parser.js";
import * as yaml from "js-yaml";
import { readJsonFile } from "./fs-utils.js";
import type { AnalysisContext, Finding, ModuleRecord } from "./types.js";

export interface DtsExportGraph {
  filePath: string;
  exportedTypes: Set<string>;
  hasModuleAugmentation: boolean;
}

export interface DependencyNode {
  name: string;
  version: string;
  dependencies: Set<string>;
}

// These packages are the analyzer itself or its public CLI entrypoint. They
// are intentionally retained when the project invokes OptiPrune from npm
// scripts or exposes the Core API through tooling.
const OPTIPRUNE_PROTECTED_PACKAGES = new Set(["@optiprune/core", "@optiprune/cli", "optiprune"]);

function isDevelopmentOnlySource(fileId: string): boolean {
  const normalized = fileId.replace(/\\/g, "/");
  return (
    /(?:^|\/)(?:test|tests|fixtures|__tests__|__mocks__)(?:\/|$)/i.test(normalized) ||
    /\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(normalized) ||
    /(?:^|\/)(?:[^/]+\.)?config\.[cm]?[jt]sx?$/i.test(normalized)
  );
}

/**
 * Dynamically resolves a command token (e.g., "mocha" or "c8") to its providing npm package
 * by inspecting `node_modules/.bin` and package `package.json` manifests.
 */
function packageNameFromResolvedPath(resolvedPath: string): string | null {
  const segments = resolvedPath.replace(/\\/g, "/").split("/");
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    if (segments[index] !== "node_modules" || index + 1 >= segments.length) continue;
    const first = segments[index + 1];
    if (!first || first === ".bin" || first === ".pnpm") continue;
    if (first.startsWith("@") && segments[index + 2]) return `${first}/${segments[index + 2]}`;
    return first;
  }
  return null;
}

/**
 * Locate an installed package manifest without assuming a mutable node_modules
 * tree. Yarn PnP exposes unplugged packages under `.yarn/unplugged`; looking
 * there avoids executing an untrusted project `.pnp.cjs` loader.
 */
function findPackageManifest(projectRoot: string, packageName: string): string | null {
  const packageSegments = packageName.split("/");
  let lookupRoot = projectRoot;
  while (true) {
    const nodeModulesManifest = path.join(
      lookupRoot,
      "node_modules",
      ...packageSegments,
      "package.json",
    );
    if (fs.existsSync(nodeModulesManifest)) return nodeModulesManifest;
    const parentRoot = path.dirname(lookupRoot);
    if (parentRoot === lookupRoot) break;
    lookupRoot = parentRoot;
  }

  const unpluggedRoot = path.join(projectRoot, ".yarn", "unplugged");
  if (!fs.existsSync(unpluggedRoot)) return null;
  try {
    for (const entry of fs.readdirSync(unpluggedRoot)) {
      const manifestPath = path.join(
        unpluggedRoot,
        entry,
        "node_modules",
        ...packageSegments,
        "package.json",
      );
      if (fs.existsSync(manifestPath)) return manifestPath;
    }
  } catch {
    // Treat a partial or unavailable PnP cache as unresolved.
  }
  return null;
}

function resolveBinaryDependency(
  token: string,
  projectRoot: string,
  declaredPackages: Iterable<string> = [],
): string | null {
  // 1. Direct Binary Check: Check if `node_modules/.bin/<token>` exists.
  const binPath = path.join(projectRoot, "node_modules", ".bin", token);
  if (fs.existsSync(binPath)) {
    try {
      const realPath = fs.realpathSync(binPath);
      const packageName = packageNameFromResolvedPath(realPath);
      if (packageName) return packageName;
    } catch {
      // Fallback to manifest scanning if realpath fails.
    }
  }

  // 2. Resolve directly from declared package manifests. This is both bounded
  // and compatible with Yarn PnP's filesystem-visible unplugged manifests.
  for (const packageName of declaredPackages) {
    const manifestPath = findPackageManifest(projectRoot, packageName);
    const resolved = manifestPath ? checkPkgBin(manifestPath, packageName, token) : null;
    if (resolved) return resolved;
  }

  // 3. Fallback scan for ordinary node_modules installations.
  const nodeModulesPath = path.join(projectRoot, "node_modules");
  if (fs.existsSync(nodeModulesPath)) {
    try {
      const packages = fs.readdirSync(nodeModulesPath);
      for (const pkgName of packages) {
        if (pkgName.startsWith(".")) continue;
        if (pkgName.startsWith("@")) {
          const scopePath = path.join(nodeModulesPath, pkgName);
          const scopedPkgs = fs.readdirSync(scopePath);
          for (const scopedPkg of scopedPkgs) {
            const fullScopeName = `${pkgName}/${scopedPkg}`;
            const pkgJsonPath = path.join(scopePath, scopedPkg, "package.json");
            const resolved = checkPkgBin(pkgJsonPath, fullScopeName, token);
            if (resolved) return resolved;
          }
          continue;
        }
        const pkgJsonPath = path.join(nodeModulesPath, pkgName, "package.json");
        const resolved = checkPkgBin(pkgJsonPath, pkgName, token);
        if (resolved) return resolved;
      }
    } catch {
      // Fall through if node_modules reading fails.
    }
  }
  return null;
}

/**
 * Helper to match a token against a package's "bin" field in package.json.
 */
function checkPkgBin(pkgJsonPath: string, pkgName: string, token: string): string | null {
  if (!fs.existsSync(pkgJsonPath)) return null;
  try {
    const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));
    if (!pkgJson.bin) return null;

    if (typeof pkgJson.bin === "string" && pkgName === token) {
      return pkgName;
    }
    if (typeof pkgJson.bin === "object" && pkgJson.bin[token]) {
      return pkgName;
    }
  } catch {
    // Ignore invalid JSON
  }
  return null;
}

/**
 * Expand packages marked as used with their installed, non-optional peer
 * dependencies. Framework plugins often mark only the framework package (for
 * example `next`), while npm's package contract requires peers such as
 * `react` and `react-dom` to be present in the consuming application.
 */
function expandRequiredPeerDependencies(usedPackages: Set<string>, manifestRoots: string[]): void {
  const queue = [...usedPackages];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const packageName = queue.shift();
    if (!packageName || visited.has(packageName)) continue;
    visited.add(packageName);

    for (const root of manifestRoots) {
      const manifestPath = findPackageManifest(root, packageName);
      if (!manifestPath) continue;
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as {
          peerDependencies?: Record<string, string>;
          peerDependenciesMeta?: Record<string, { optional?: boolean }>;
        };
        for (const peerName of Object.keys(manifest.peerDependencies ?? {})) {
          if (manifest.peerDependenciesMeta?.[peerName]?.optional === true) continue;
          if (usedPackages.has(peerName)) continue;
          usedPackages.add(peerName);
          queue.push(peerName);
        }
      } catch {
        // Ignore missing or malformed third-party manifests.
      }
      break;
    }
  }
}

export async function parseDtsWithSwc(entryPointRelative: string): Promise<DtsExportGraph> {
  const absolutePath = path.resolve(entryPointRelative);

  if (!fs.existsSync(absolutePath)) {
    return { filePath: absolutePath, exportedTypes: new Set(), hasModuleAugmentation: false };
  }

  const source = fs.readFileSync(absolutePath, "utf-8");
  const result = parseWithYukuBackend(source, { lang: "dts", sourceType: "module" });
  const program = result.program as any;

  const exportedTypes = new Set<string>();
  let hasModuleAugmentation = false;

  for (const item of (program.body ?? []) as any[]) {
    if (item.type === "ExportNamedDeclaration") {
      if (item.declaration) {
        const decl = item.declaration as any;
        if (decl.id?.name) {
          exportedTypes.add(decl.id.name);
        }
      }
      for (const spec of (item.specifiers ?? []) as any[]) {
        if (spec.type === "ExportSpecifier") {
          const name = spec.exported?.name ?? spec.local?.name;
          if (name) exportedTypes.add(name);
        }
      }
    } else if (item.type === "ExportDefaultDeclaration") {
      exportedTypes.add("default");
    }

    if (
      item.type === "TSModuleDeclaration" ||
      (item.type === "ExportNamedDeclaration" && item.declaration?.type === "TSModuleDeclaration")
    ) {
      hasModuleAugmentation = true;
    }
  }

  return {
    filePath: absolutePath,
    exportedTypes,
    hasModuleAugmentation,
  };
}

export function buildLockfileGraph(projectRoot: string): Map<string, DependencyNode> {
  const graph = new Map<string, DependencyNode>();
  const pnpmLockPath = path.join(projectRoot, "pnpm-lock.yaml");
  const packageLockPath = path.join(projectRoot, "package-lock.json");

  if (fs.existsSync(packageLockPath)) {
    try {
      const raw = fs.readFileSync(packageLockPath, "utf-8");
      const cleanRaw = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
      const parsed = JSON.parse(cleanRaw);
      const packages = parsed.packages || {};

      for (const [pkgPath, meta] of Object.entries<any>(packages)) {
        if (!pkgPath) continue;

        const cleanName = pkgPath.replace(/^node_modules\//, "");
        const deps = new Set<string>(
          Object.keys(meta.dependencies || {}).concat(Object.keys(meta.peerDependencies || {})),
        );

        graph.set(cleanName, {
          name: cleanName,
          version: meta.version || "unknown",
          dependencies: deps,
        });
      }
    } catch (e) {}
  } else if (fs.existsSync(pnpmLockPath)) {
    try {
      const raw = fs.readFileSync(pnpmLockPath, "utf-8");
      const parsed = yaml.load(raw) as any;
      const snapshots = parsed.snapshots || {};

      for (const [pkgId, meta] of Object.entries<any>(snapshots)) {
        const nameMatch = pkgId.match(/^\/(@?[^@]+)/);
        const cleanName = (nameMatch ? nameMatch[1] : pkgId) as string;

        const deps = new Set<string>(
          Object.keys(meta.dependencies || {}).concat(Object.keys(meta.peerDependencies || {})),
        );

        graph.set(cleanName, {
          name: cleanName,
          version: "pnpm-managed",
          dependencies: deps,
        });
      }
    } catch (e) {}
  }

  return graph;
}

export async function analyzeLayer6(context: AnalysisContext): Promise<Finding[]> {
  const findings: Finding[] = [];
  const projectRoot = context.options.rootDir;

  const lockfileGraph = buildLockfileGraph(projectRoot);
  const packageImportMap = new Map<string, Set<string>>();
  const packageImportFiles = new Map<string, Map<string, Set<string>>>();
  const globalImports = new Set<string>();
  const reachableGlobalImports = new Set<string>();
  const workspacePackageNames = new Set<string>(context.options.monorepo?.packageMap.keys() ?? []);

  const projectHasTypesNode = Array.from(context.modules.keys()).some((f) => {
    const normalized = f.replace(/\\/g, "/");
    return (
      normalized.includes("node_modules/@types/node/") ||
      normalized.endsWith("node_modules/@types/node") ||
      normalized.includes("node_modules/@types/node/index.d.ts")
    );
  });

  const NODE_BUILTINS = new Set([
    "assert",
    "async_hooks",
    "buffer",
    "child_process",
    "cluster",
    "console",
    "constants",
    "crypto",
    "dgram",
    "diagnostics_channel",
    "dns",
    "domain",
    "events",
    "fs",
    "http",
    "http2",
    "https",
    "inspector",
    "module",
    "net",
    "os",
    "path",
    "perf_hooks",
    "process",
    "punycode",
    "querystring",
    "readline",
    "repl",
    "stream",
    "string_decoder",
    "sys",
    "timers",
    "tls",
    "trace_events",
    "tty",
    "url",
    "util",
    "v8",
    "vm",
    "wasi",
    "worker_threads",
    "zlib",
    "node:assert",
    "node:async_hooks",
    "node:buffer",
    "node:child_process",
    "node:cluster",
    "node:console",
    "node:crypto",
    "node:dgram",
    "node:dns",
    "node:domain",
    "node:events",
    "node:fs",
    "node:http",
    "node:https",
    "node:inspector",
    "node:module",
    "node:net",
    "node:os",
    "node:path",
    "node:process",
    "node:punycode",
    "node:querystring",
    "node:readline",
    "node:repl",
    "node:stream",
    "node:string_decoder",
    "node:sys",
    "node:timers",
    "node:tls",
    "node:trace_events",
    "node:tty",
    "node:url",
    "node:util",
    "node:v8",
    "node:vm",
    "node:wasi",
    "node:worker_threads",
    "node:zlib",
  ]);

  for (const module of context.modules.values()) {
    let ownerPackage = "root";
    if (context.options.monorepo) {
      for (const [name, pkg] of context.options.monorepo.packageMap.entries()) {
        const locationPrefix = pkg.location.endsWith("/") ? pkg.location : pkg.location + "/";
        if (module.id.startsWith(locationPrefix) || module.id === pkg.location) {
          ownerPackage = name;
          break;
        }
      }
    }

    const pkgImports = packageImportMap.get(ownerPackage) || new Set<string>();
    if (!packageImportMap.has(ownerPackage)) packageImportMap.set(ownerPackage, pkgImports);
    const packageFiles = packageImportFiles.get(ownerPackage) || new Map<string, Set<string>>();
    if (!packageImportFiles.has(ownerPackage)) packageImportFiles.set(ownerPackage, packageFiles);
    const moduleIsReachable =
      context.reachable.has(module.id) || context.maybeReachable.has(module.id);

    for (const edge of module.edges) {
      if (edge.resolution === "external") {
        const specifier = edge.rawSpecifier;
        if (!specifier) continue;

        const cleanSpec = specifier.startsWith("node:") ? specifier.slice(5) : specifier;
        if (specifier.startsWith("node:")) continue;
        if (projectHasTypesNode && (NODE_BUILTINS.has(specifier) || NODE_BUILTINS.has(cleanSpec))) {
          continue;
        }

        const parts = cleanSpec.split("/");
        const pkgName = cleanSpec.startsWith("@")
          ? `${parts[0] ?? ""}/${parts[1] ?? ""}`
          : (parts[0] ?? "");

        if (pkgName && !NODE_BUILTINS.has(pkgName) && !NODE_BUILTINS.has(`node:${pkgName}`)) {
          pkgImports.add(pkgName);
          globalImports.add(pkgName);
          const importingFiles = packageFiles.get(pkgName) || new Set<string>();
          importingFiles.add(module.id);
          packageFiles.set(pkgName, importingFiles);
          if (moduleIsReachable) reachableGlobalImports.add(pkgName);
        }
      } else if (edge.resolution === "resolved" && edge.target && context.options.monorepo) {
        for (const [pkgName, pkg] of context.options.monorepo.packageMap.entries()) {
          const normalizedTarget = edge.target.replace(/\\/g, "/");
          const normalizedWorkspaceLocation = pkg.location.replace(/\\/g, "/").replace(/\/$/, "");
          if (
            normalizedTarget.startsWith(`${normalizedWorkspaceLocation}/`) ||
            normalizedTarget === normalizedWorkspaceLocation
          ) {
            pkgImports.add(pkgName);
            globalImports.add(pkgName);
            if (moduleIsReachable) reachableGlobalImports.add(pkgName);
            break;
          }
        }
      }
    }
  }

  const manifestPaths = new Map<string, string>();
  manifestPaths.set("root", path.join(projectRoot, "package.json"));
  if (context.options.monorepo) {
    for (const [name, pkg] of context.options.monorepo.packageMap.entries()) {
      manifestPaths.set(name, pkg.manifestPath);
    }
  }

  // Build a Set of dependencies the user explicitly wants to ignore so we
  // never emit unused-dependency / unused-dev-dependency findings for them.
  const globallyIgnoredDependencies = new Set<string>(context.options.ignoreDependencies ?? []);

  for (const [pkgName, manifestPath] of manifestPaths.entries()) {
    if (fs.existsSync(manifestPath)) {
      const pkg = await readJsonFile<Record<string, any>>(manifestPath);
      if (!pkg) continue;

      const dependencies = pkg.dependencies || {};
      const devDependencies = pkg.devDependencies || {};
      const peerDependencies = pkg.peerDependencies || {};
      const peerDependenciesMeta = pkg.peerDependenciesMeta || {};
      const scripts = pkg.scripts || {};
      const relativeManifest = path.posix.relative(projectRoot, manifestPath);
      const ignoreDeps = new Set<string>([
        ...globallyIgnoredDependencies,
        ...(context.options.packageIgnoreDependencies?.get(manifestPath) ?? []),
      ]);

      const importedInThisPackage = packageImportMap.get(pkgName) || new Set<string>();
      const isRootMonorepoManifest = pkgName === "root" && Boolean(context.options.monorepo);
      const workspaceDeclares = (dependency: string): boolean =>
        Array.from(context.options.monorepo?.packageMap.values() ?? []).some((workspace) =>
          workspace.allDependencies.has(dependency),
        );
      const workspaceHasTypeScriptSources =
        isRootMonorepoManifest &&
        Array.from(context.modules.keys()).some((fileId) => /\.(?:ts|tsx|mts|cts)$/.test(fileId));
      const importFilesFor = (dependency: string): string[] =>
        Array.from(packageImportFiles.get(pkgName)?.get(dependency) ?? []);
      const hasReachableImport = (dependency: string): boolean =>
        importFilesFor(dependency).some(
          (fileId) => context.reachable.has(fileId) || context.maybeReachable.has(fileId),
        );
      const onlyUsedByUnreachableFiles = (dependency: string): string[] => {
        const files = importFilesFor(dependency);
        return files.length > 0 && !hasReachableImport(dependency) ? files : [];
      };

      // Peer contracts must remain package-local in a monorepo. Seed the
      // traversal with only this manifest's reachable imports plus plugin
      // observations, so a workspace import cannot retain a root dependency.
      const packagePeerUsage = new Set(context.usedPackages ?? []);
      for (const importedPackage of importedInThisPackage) {
        // The import edge itself is sufficient evidence for peer traversal;
        // reachability filtering is applied later when emitting findings.
        packagePeerUsage.add(importedPackage);
      }
      // Some package-manager graphs expose the host relationship in manifests
      // even when the host's source entry cannot be resolved by the analyzer.
      // Seed only dependencies that actually declare peer contracts; ordinary
      // unused dependencies remain eligible for diagnostics.
      for (const dependencyName of Object.keys(dependencies)) {
        const hostManifest = findPackageManifest(path.dirname(manifestPath), dependencyName);
        if (!hostManifest) continue;
        try {
          const hostPackage = JSON.parse(fs.readFileSync(hostManifest, "utf8")) as {
            peerDependencies?: Record<string, string>;
          };
          if (Object.keys(hostPackage.peerDependencies ?? {}).length > 0) {
            packagePeerUsage.add(dependencyName);
          }
        } catch {
          // Ignore malformed installed manifests.
        }
      }
      expandRequiredPeerDependencies(packagePeerUsage, [path.dirname(manifestPath), projectRoot]);

      const scriptUsages = new Set<string>();
      const scriptPackages = new Set<string>();

      // Plugin activation is not dependency usage evidence. Dependencies are
      // considered used only when imports, scripts, explicit config marks, or
      // verified configuration files establish a concrete relationship.

      const shellCommands = new Set([
        "if",
        "then",
        "else",
        "fi",
        "for",
        "in",
        "do",
        "done",
        "exit",
        "echo",
        "cd",
        "rm",
        "mkdir",
        "cp",
        "mv",
        "node",
        "run",
        "exec",
        "test",
        "audit",
        "install",
        "add",
        "remove",
        "outdated",
        "update",
        "publish",
        "login",
        "logout",
        "link",
        "unlink",
        "whoami",
        "config",
        "info",
        "init",
        "help",
        "version",
        "build",
        "start",
        "stop",
        "restart",
        "dev",
        "serve",
        "query",
      ]);

      const STATIC_BINARY_FALLBACKS: Record<string, string> = {
        tsc: "typescript",
        vitest: "vitest",
        jest: "jest",
        eslint: "eslint",
        prettier: "prettier",
        oxlint: "oxlint",
        oxfmt: "oxfmt",
        tsdown: "tsdown",
        vite: "vite",
        rollup: "rollup",
        webpack: "webpack",
        esbuild: "esbuild",
        jscpd: "jscpd",
        knip: "knip",
        husky: "husky",
        "lint-staged": "lint-staged",
        commitlint: "@commitlint/cli",
        "cross-env": "cross-env",
        nyc: "nyc",
        mocha: "mocha",
        nodemon: "nodemon",
        rimraf: "rimraf",
        c8: "c8",
        "ts-node": "ts-node",
        tsx: "tsx",
        standard: "standard",
        stylelint: "stylelint",
        concurrently: "concurrently",
        "wait-on": "wait-on",
      };

      // Bun treats the next non-flag argument as its entry point. This is
      // positional syntax, so it must not depend on file extensions or on
      // whether the target currently exists on disk.
      const consumeCommandFlags = (tokens: string[], start: number, manager?: string): number => {
        let index = start;
        while (index < tokens.length) {
          const token = tokens[index];
          if (!token?.startsWith("-")) break;

          // pnpm/yarn option values are positional tokens. In particular,
          // `pnpm --filter @scope/pkg script` must not treat `@scope/pkg`
          // as a binary or package dependency.
          if (manager === "pnpm" || manager === "yarn") {
            if (
              token === "--filter" ||
              token === "-F" ||
              token === "--workspace-root" ||
              token === "-w"
            ) {
              index += token === "--filter" || token === "-F" ? 2 : 1;
              continue;
            }
            if (token.startsWith("--filter=")) {
              index += 1;
              continue;
            }
          }

          index += 1;
        }
        return index;
      };

      const allDeclaredDeps = new Set([
        ...Object.keys(dependencies),
        ...Object.keys(devDependencies),
        ...Object.keys(pkg.peerDependencies || {}),
      ]);

      if (context.options.monorepo && pkgName !== "root") {
        const rootManifest = manifestPaths.get("root");
        if (rootManifest && fs.existsSync(rootManifest)) {
          try {
            const rootPkg = JSON.parse(fs.readFileSync(rootManifest, "utf-8"));
            [
              ...Object.keys(rootPkg.dependencies || {}),
              ...Object.keys(rootPkg.devDependencies || {}),
              ...Object.keys(rootPkg.peerDependencies || {}),
            ].forEach((d) => allDeclaredDeps.add(d));
          } catch (e) {}
        }
      }

      for (const script of Object.values(scripts) as string[]) {
        // Split command strings across shell operators (&&, ||, ;, |)
        const commands = script.split(/[&|;]/);
        for (const fullCmd of commands) {
          const tokens = fullCmd.trim().split(/\s+/);

          // Parse all tokens sequentially to detect wrapped commands (e.g. "c8 mocha", "cross-env FOO=bar mocha")
          for (let i = 0; i < tokens.length; i++) {
            const rawToken = tokens[i];
            if (!rawToken) continue;

            const token = rawToken.replace(/^["']|["']$/g, "");

            // 1. Skip environment variables and flags
            if (token.includes("=") || token.startsWith("-")) continue;

            // 2. Bun uses positional entry-point syntax. After Bun flags,
            // the next non-flag token is an entry point. `bun run <script>`
            // is the only special case: an existing package script is a script
            // reference, not a dependency or binary.
            if (token === "bun") {
              let targetIndex = consumeCommandFlags(tokens, i + 1);
              const mode = tokens[targetIndex];

              if (mode === "run" || mode === "exec") {
                targetIndex = consumeCommandFlags(tokens, targetIndex + 1);
              }

              // Bun's positional target is handled by discoverPackageScriptTargets
              // in fs-utils and promoted to an analyzer entry point there. It must
              // not enter scriptUsages/scriptPackages: those sets represent
              // binaries and packages and are later checked for missing deps.
              // This applies equally to `bun <path>`, `bun --watch <path>`,
              // `bun run <path>`, and `bun run <script>`.
              break; // Bun target handled by the entry-point extractor
            }

            // 3. Handle the other package managers: npm run <script>, npx <pkg>
            if (["npx", "npm", "pnpm", "yarn"].includes(token)) {
              let pkgIndex = consumeCommandFlags(tokens, i + 1, token);
              if (["run", "exec", "dlx"].includes(tokens[pkgIndex] ?? "")) {
                pkgIndex = consumeCommandFlags(tokens, pkgIndex + 1, token);
              }
              const pkg = tokens[pkgIndex]?.replace(/^["']|["']$/g, "");
              // Check if the argument is a script name first
              if (pkg && !pkg.startsWith("-") && !scripts[pkg] && !shellCommands.has(pkg)) {
                scriptUsages.add(pkg);
                const resolved =
                  resolveBinaryDependency(pkg, projectRoot, allDeclaredDeps) ||
                  STATIC_BINARY_FALLBACKS[pkg] ||
                  pkg;
                scriptPackages.add(resolved);
              }
              break; // Token handled via package manager handler
            }

            // A package script may have the same name as its installed binary
            // (for example: { "optiprune": "optiprune" }). Resolve the binary
            // before treating the token as an internal script reference.
            // This preserves npm-script usage evidence for CLI dependencies.
            const tokenParts = token.split("/");
            const tokenPkgBase = token.startsWith("@")
              ? tokenParts.length >= 2
                ? `${tokenParts[0]}/${tokenParts[1]}`
                : null
              : tokenParts[0];
            const tokenBinaryPackage = resolveBinaryDependency(token, projectRoot, allDeclaredDeps);
            const tokenResolvedPackage =
              tokenBinaryPackage && tokenBinaryPackage !== ".bin"
                ? tokenBinaryPackage
                : STATIC_BINARY_FALLBACKS[token] ||
                  (allDeclaredDeps.has(token)
                    ? token
                    : tokenPkgBase && allDeclaredDeps.has(tokenPkgBase)
                      ? tokenPkgBase
                      : null);
            if (tokenResolvedPackage) {
              scriptUsages.add(token);
              scriptPackages.add(tokenResolvedPackage);
              continue;
            }

            // 3. Skip if it's an internal script reference (trap for "npm test" or direct script calls)
            if (scripts[token]) continue;

            // 4. Skip shell built-ins and relative/absolute script files
            if (
              shellCommands.has(token) ||
              token.startsWith(".") ||
              token.startsWith("/") ||
              token.endsWith(".ts") ||
              token.endsWith(".js")
            ) {
              continue;
            }

            // Dynamic Check: Try resolving the token via physical node_modules bin files
            // Fallback to allDeclaredDeps if resolution fails (handles cases where binary name == package name)
            const parts = token.split("/");
            const pkgBase = token.startsWith("@")
              ? parts.length >= 2
                ? `${parts[0]}/${parts[1]}`
                : null
              : parts[0];
            const resolved = resolveBinaryDependency(token, projectRoot, allDeclaredDeps);
            const resolvedPackage =
              resolved && resolved !== ".bin"
                ? resolved
                : STATIC_BINARY_FALLBACKS[token] ||
                  (allDeclaredDeps.has(token)
                    ? token
                    : pkgBase && allDeclaredDeps.has(pkgBase)
                      ? pkgBase
                      : null);

            if (resolvedPackage) {
              scriptUsages.add(token);
              scriptPackages.add(resolvedPackage);
            }
          }
        }

        if (script.includes("vitest") && script.includes("--coverage")) {
          scriptPackages.add("@vitest/coverage-v8");
          scriptPackages.add("@vitest/coverage-c8");
        }
      }

      const usedNodeBuiltins = new Set<string>();

      for (const imp of importedInThisPackage) {
        const cleanImp = imp.startsWith("node:") ? imp.slice(5) : imp;
        if (imp.startsWith("node:") || NODE_BUILTINS.has(imp) || NODE_BUILTINS.has(cleanImp)) {
          usedNodeBuiltins.add(imp);
          continue;
        }

        if (projectHasTypesNode && (imp.startsWith("node:") || NODE_BUILTINS.has(cleanImp))) {
          continue;
        }

        const importFiles = importFilesFor(imp);
        const isDevOnlyImport =
          importFiles.length > 0 && importFiles.every(isDevelopmentOnlySource);
        if (
          !allDeclaredDeps.has(imp) &&
          !workspacePackageNames.has(imp) &&
          !imp.startsWith(".") &&
          !imp.startsWith("/") &&
          !imp.includes(":") &&
          hasReachableImport(imp)
        ) {
          findings.push({
            rule: isDevOnlyImport ? "missing-dev-dependency" : "missing-dependency",
            severity: "error",
            confidence: "high",
            message: `Package '${imp}' is imported but not declared in package.json.`,
            file: relativeManifest,
            evidence: {
              package: imp,
              type: isDevOnlyImport ? "devDependency" : "dependency",
              ...(importFiles.length > 0 && { importingFiles: importFiles }),
            },
          });
        }
      }

      for (const bin of scriptUsages) {
        const resolved = resolveBinaryDependency(bin, projectRoot, allDeclaredDeps);
        const mappedPkg =
          resolved && resolved !== ".bin" ? resolved : STATIC_BINARY_FALLBACKS[bin] || bin;

        if (!allDeclaredDeps.has(mappedPkg) && !bin.startsWith("./") && !bin.startsWith("../")) {
          const COMMON_GLOBALS = [
            "sh",
            "bash",
            "zsh",
            "ls",
            "cat",
            "grep",
            "sed",
            "awk",
            "find",
            "curl",
            "wget",
            "git",
            "sudo",
            "chmod",
            "chown",
            "env",
            "xargs",
          ];
          if (!COMMON_GLOBALS.includes(bin)) {
            findings.push({
              rule: "missing-dev-dependency",
              severity: "error",
              confidence: "high",
              message: `Binary/Command '${bin}' (from package '${mappedPkg}') is used in scripts but not declared in devDependencies.`,
              file: relativeManifest,
              evidence: { package: mappedPkg, type: "devDependency", source: "script" },
            });
          }
        }
      }

      const commonConfigs = [
        ".eslintrc",
        ".prettierrc",
        "vitest.config",
        "jest.config",
        "webpack.config",
        "vite.config",
        "rollup.config",
        "postcss.config",
        "tailwind.config",
        "tsconfig.json",
        "babel.config",
        "swc.config",
        "lerna.json",
        "turbo.json",
        "nx.json",
        ".env",
        "svelte.config",
        "vue.config",
        "astro.config",
        "package.json",
        ".husky",
        "knip.json",
        "next.config",
        "nodemon.json",
        "release-it",
        ".release-it",
        "stylelint.config",
        "postcss.config",
      ];

      for (const dep of Object.keys(dependencies)) {
        if (devDependencies[dep] !== undefined) {
          findings.push({
            rule: "duplicate-dependency-section",
            severity: "warning",
            confidence: "high",
            message: `Package '${dep}' is declared in both dependencies and devDependencies in ${relativeManifest}.`,
            file: relativeManifest,
            evidence: { package: dep, type: "duplicateDependencySection" },
          });
        }
      }

      for (const dep of Object.keys(dependencies)) {
        if (packagePeerUsage.has(dep)) continue;
        if (OPTIPRUNE_PROTECTED_PACKAGES.has(dep)) continue;
        if (dep === "@types/node") continue;

        if (dep.startsWith("@types/")) {
          const basePkg = dep.slice(7).replace("__", "/");
          if (
            hasReachableImport(basePkg) ||
            reachableGlobalImports.has(basePkg) ||
            (isRootMonorepoManifest && workspaceDeclares(basePkg)) ||
            dependencies[basePkg] ||
            devDependencies[basePkg]
          ) {
            continue;
          }
        }

        const isMarkedUsed =
          context.usedExports?.has(`${relativeManifest}:dependencies:${dep}`) ||
          context.usedExports?.has(`${relativeManifest}:devDependencies:${dep}`) ||
          context.usedExports?.has(`package.json:dependencies:${dep}`) ||
          context.usedExports?.has(`package.json:devDependencies:${dep}`);

        const hasRelatedConfig =
          commonConfigs.some((cfg) => {
            const depBase = dep
              .split("/")[0]
              ?.replace(/^@/, "")
              .replace(/-config$/, "")
              .replace(/config-/, "")
              .replace(/^eslint-plugin-/, "")
              .replace(/^prettier-plugin-/, "");
            if (cfg.includes(depBase || "___never___")) {
              return (
                fs.existsSync(path.join(projectRoot, cfg)) ||
                fs.existsSync(path.join(projectRoot, "." + depBase))
              );
            }
            return false;
          }) ||
          (dep === "husky" && fs.existsSync(path.join(projectRoot, ".husky")));

        const isUsed =
          isMarkedUsed ||
          hasReachableImport(dep) ||
          (dep === "typescript" && workspaceHasTypeScriptSources) ||
          scriptUsages.has(dep) ||
          scriptPackages.has(dep) ||
          hasRelatedConfig;

        // Skip packages the user has explicitly asked to ignore.
        if (ignoreDeps.has(dep)) continue;

        if (!isUsed) {
          findings.push({
            rule: "unused-dependency",
            severity: "warning",
            confidence: "high",
            message: `Package '${dep}' is declared as a dependency in ${relativeManifest} but never imported or used in scripts.`,
            file: relativeManifest,
            evidence: {
              package: dep,
              type: "dependency",
              ...(onlyUsedByUnreachableFiles(dep).length > 0 && {
                onlyUsedByUnreachableFiles: true,
                removalRequiresFiles: onlyUsedByUnreachableFiles(dep),
              }),
            },
          });
        }
      }

      for (const dep of Object.keys(devDependencies)) {
        if (pkg.name && dep === pkg.name) {
          continue;
        }
        // Optional peers commonly appear in devDependencies to support local
        // development. Their host relationship, not a direct import, is usage.
        if (peerDependenciesMeta[dep]?.optional === true) continue;

        if (packagePeerUsage.has(dep)) continue;
        if (OPTIPRUNE_PROTECTED_PACKAGES.has(dep)) continue;
        if (dep.startsWith("@types/")) {
          const basePkg = dep.slice(7).replace("__", "/");
          if (dep === "@types/node") continue;
          if (
            hasReachableImport(basePkg) ||
            reachableGlobalImports.has(basePkg) ||
            (isRootMonorepoManifest && workspaceDeclares(basePkg)) ||
            dependencies[basePkg] ||
            devDependencies[basePkg]
          ) {
            continue;
          }
        }

        const isMarkedUsed =
          context.usedExports?.has(`${relativeManifest}:dependencies:${dep}`) ||
          context.usedExports?.has(`${relativeManifest}:devDependencies:${dep}`) ||
          context.usedExports?.has(`package.json:dependencies:${dep}`) ||
          context.usedExports?.has(`package.json:devDependencies:${dep}`);

        const hasRelatedConfig =
          commonConfigs.some((cfg) => {
            const depBase = dep
              .split("/")[0]
              ?.replace(/^@/, "")
              .replace(/-config$/, "")
              .replace(/config-/, "")
              .replace(/^eslint-plugin-/, "")
              .replace(/^prettier-plugin-/, "");
            if (cfg.includes(depBase || "___never___")) {
              return (
                fs.existsSync(path.join(projectRoot, cfg)) ||
                fs.existsSync(path.join(projectRoot, "." + depBase))
              );
            }
            return false;
          }) ||
          (dep === "husky" && fs.existsSync(path.join(projectRoot, ".husky")));

        const isUsed =
          isMarkedUsed ||
          hasReachableImport(dep) ||
          (isRootMonorepoManifest && reachableGlobalImports.has(dep)) ||
          (dep === "typescript" && workspaceHasTypeScriptSources) ||
          scriptUsages.has(dep) ||
          scriptPackages.has(dep) ||
          hasRelatedConfig;

        // Skip packages the user has explicitly asked to ignore.
        if (ignoreDeps.has(dep)) continue;

        if (!isUsed) {
          findings.push({
            rule: "unused-dev-dependency",
            severity: "info",
            confidence: "medium",
            message: `DevDependency '${dep}' in ${relativeManifest} appears unused.`,
            file: relativeManifest,
            evidence: {
              package: dep,
              type: "devDependency",
              ...(onlyUsedByUnreachableFiles(dep).length > 0 && {
                onlyUsedByUnreachableFiles: true,
                removalRequiresFiles: onlyUsedByUnreachableFiles(dep),
              }),
            },
          });
        }
      }

      for (const dep of Object.keys(peerDependencies)) {
        const optional = peerDependenciesMeta[dep]?.optional === true;
        const isHostProvided =
          dependencies[dep] !== undefined || devDependencies[dep] !== undefined;
        if (optional || isHostProvided || ignoreDeps.has(dep)) continue;
        if (packagePeerUsage.has(dep) || OPTIPRUNE_PROTECTED_PACKAGES.has(dep)) continue;

        const isUsed =
          hasReachableImport(dep) ||
          reachableGlobalImports.has(dep) ||
          scriptUsages.has(dep) ||
          scriptPackages.has(dep) ||
          context.usedExports?.has(`${relativeManifest}:peerDependencies:${dep}`) ||
          context.usedExports?.has(`package.json:peerDependencies:${dep}`);
        if (!isUsed) {
          findings.push({
            rule: "unused-peer-dependency",
            severity: "info",
            confidence: "medium",
            message: `Peer dependency '${dep}' in ${relativeManifest} appears unused.`,
            file: relativeManifest,
            evidence: { package: dep, type: "peerDependency" },
          });
        }
      }
    }
  }

  for (const module of context.modules.values()) {
    const isReachable = context.reachable.has(module.id) || context.maybeReachable.has(module.id);
    if (!isReachable) {
      for (const exp of module.exports) {
        if (exp.isExternalContract) {
          findings.push({
            rule: "protected-contract",
            severity: "info",
            confidence: "high",
            message: `[Layer 6] Revoked protection for unreferenced contract: ${exp.exportedAs} (File is unreachable).`,
            file: module.relativePath,
            ...(exp.location !== undefined && { location: exp.location }),
            evidence: { symbol: exp.exportedAs, reason: "unreachable-file" },
          });
          exp.isExternalContract = false;
        }
      }
    }
  }

  return findings;
}
