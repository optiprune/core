import fs from 'node:fs';
import path from 'pathe';
import { parse as yukuParse } from 'yuku-parser';
import * as yaml from 'js-yaml';
import { readJsonFile } from './fs-utils.js';
import type { AnalysisContext, Finding, ModuleRecord } from './types.js';

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

/**
 * Parses a library's entry point `.d.ts` file using yuku-parser.
 * Handles Windows & POSIX paths natively.
 * Replaces the previous SWC-based implementation.
 */
export async function parseDtsWithSwc(entryPointRelative: string): Promise<DtsExportGraph> {
  const absolutePath = path.resolve(entryPointRelative);

  if (!fs.existsSync(absolutePath)) {
    return { filePath: absolutePath, exportedTypes: new Set(), hasModuleAugmentation: false };
  }

  const source = fs.readFileSync(absolutePath, 'utf-8');
  // yuku-parser: use 'dts' lang for declaration files
  const result = yukuParse(source, { lang: 'dts', sourceType: 'module' });
  const program = result.program as any;

  const exportedTypes = new Set<string>();
  let hasModuleAugmentation = false;

  for (const item of (program.body ?? []) as any[]) {
    // yuku-parser emits ESTree-compatible nodes (ExportNamedDeclaration, ExportDefaultDeclaration)
    if (item.type === 'ExportNamedDeclaration') {
      // Inline declaration: export interface Foo {}, export type Bar = ...
      if (item.declaration) {
        const decl = item.declaration as any;
        if (decl.id?.name) {
          exportedTypes.add(decl.id.name);
        }
      }
      // Re-export specifiers: export { Foo, Bar }
      for (const spec of (item.specifiers ?? []) as any[]) {
        if (spec.type === 'ExportSpecifier') {
          const name = spec.exported?.name ?? spec.local?.name;
          if (name) exportedTypes.add(name);
        }
      }
    } else if (item.type === 'ExportDefaultDeclaration') {
      exportedTypes.add('default');
    }

    // Detect ambient module augmentation: declare module "..."
    if (
      item.type === 'TSModuleDeclaration' ||
      (item.type === 'ExportNamedDeclaration' && item.declaration?.type === 'TSModuleDeclaration')
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

/**
 * Fast-path topology extraction from lockfiles.
 */
export function buildLockfileGraph(projectRoot: string): Map<string, DependencyNode> {
  const graph = new Map<string, DependencyNode>();
  const pnpmLockPath = path.join(projectRoot, 'pnpm-lock.yaml');
  const packageLockPath = path.join(projectRoot, 'package-lock.json');

  if (fs.existsSync(packageLockPath)) {
    try {
      const raw = fs.readFileSync(packageLockPath, 'utf-8');
      const cleanRaw = raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw;
      const parsed = JSON.parse(cleanRaw);
      const packages = parsed.packages || {};

      for (const [pkgPath, meta] of Object.entries<any>(packages)) {
        if (!pkgPath) continue;
        
        const cleanName = pkgPath.replace(/^node_modules\//, '');
        const deps = new Set<string>(
          Object.keys(meta.dependencies || {}).concat(Object.keys(meta.peerDependencies || {}))
        );

        graph.set(cleanName, {
          name: cleanName,
          version: meta.version || 'unknown',
          dependencies: deps,
        });
      }
    } catch (e) {
      // Ignore lockfile parse errors
    }
  } else if (fs.existsSync(pnpmLockPath)) {
    try {
      const raw = fs.readFileSync(pnpmLockPath, 'utf-8');
      const parsed = yaml.load(raw) as any;
      const snapshots = parsed.snapshots || {};

      for (const [pkgId, meta] of Object.entries<any>(snapshots)) {
        const nameMatch = pkgId.match(/^\/(@?[^@]+)/);
        const cleanName = (nameMatch ? nameMatch[1] : pkgId) as string;
        
        const deps = new Set<string>(
          Object.keys(meta.dependencies || {}).concat(Object.keys(meta.peerDependencies || {}))
        );

        graph.set(cleanName, {
          name: cleanName,
          version: 'pnpm-managed',
          dependencies: deps,
        });
      }
    } catch (e) {
      // Ignore lockfile parse errors
    }
  }

  return graph;
}

/**
 * Layer 6: Dependency & Boundary Engine
 * Audits package usage and refines Layer 5 protections.
 */
export async function analyzeLayer6(context: AnalysisContext): Promise<Finding[]> {
  const findings: Finding[] = [];
  const projectRoot = context.options.rootDir;
  
  // 1. Audit declared dependencies vs imported ones
  const lockfileGraph = buildLockfileGraph(projectRoot);
  
  // Track imports per-package for monorepos, or globally for simple repos
  const packageImportMap = new Map<string, Set<string>>();
  const globalImports = new Set<string>();

  for (const module of context.modules.values()) {
    // Determine which workspace this module belongs to
    let ownerPackage = 'root';
    if (context.options.monorepo) {
      for (const [name, pkg] of context.options.monorepo.packageMap.entries()) {
        if (module.id.startsWith(pkg.location + path.sep) || module.id === pkg.location) {
          ownerPackage = name;
          break;
        }
      }
    }

    const pkgImports = packageImportMap.get(ownerPackage) || new Set<string>();
    if (!packageImportMap.has(ownerPackage)) packageImportMap.set(ownerPackage, pkgImports);

    for (const edge of module.edges) {
      if (edge.resolution === 'external') {
        const parts = edge.rawSpecifier.split('/');
        const pkgName = edge.rawSpecifier.startsWith('@') ? `${parts[0] ?? ''}/${parts[1] ?? ''}` : (parts[0] ?? '');
        pkgImports.add(pkgName);
        globalImports.add(pkgName);
      } else if (edge.resolution === 'resolved' && edge.target && context.options.monorepo) {
        for (const [pkgName, pkg] of context.options.monorepo.packageMap.entries()) {
          if (edge.target.startsWith(pkg.location + path.sep) || edge.target === pkg.location) {
            pkgImports.add(pkgName);
            globalImports.add(pkgName);
            break;
          }
        }
      }
    }
  }

  // Find unused direct dependencies from all package.json files
  const manifestPaths = new Map<string, string>();
  manifestPaths.set('root', path.join(projectRoot, 'package.json'));
  if (context.options.monorepo) {
    for (const [name, pkg] of context.options.monorepo.packageMap.entries()) {
      manifestPaths.set(name, pkg.manifestPath);
    }
  }

  for (const [pkgName, manifestPath] of manifestPaths.entries()) {
    if (fs.existsSync(manifestPath)) {
      const pkg = await readJsonFile<Record<string, any>>(manifestPath);
      if (!pkg) continue;

      const dependencies = pkg.dependencies || {};
      const devDependencies = pkg.devDependencies || {};
      const scripts = pkg.scripts || {};
      const relativeManifest = path.posix.relative(projectRoot, manifestPath);
      
      const importedInThisPackage = packageImportMap.get(pkgName) || new Set<string>();

      // 1. Collect binary usages from scripts
      const scriptUsages = new Set<string>();
      const shellCommands = new Set(['if', 'then', 'else', 'fi', 'for', 'in', 'do', 'done', 'exit', 'echo', 'cd', 'rm', 'mkdir', 'cp', 'mv', 'node', 'npm', 'pnpm', 'yarn', 'bun', 'run', 'exec', 'test', 'audit', 'install', 'add', 'remove', 'outdated', 'update', 'publish', 'login', 'logout', 'link', 'unlink', 'whoami', 'config', 'info', 'init', 'help', 'version', 'build', 'start', 'stop', 'restart', 'dev', 'serve']);
      
      for (const script of Object.values(scripts) as string[]) {
        // Improved Regex-based binary extraction
        const commandRegex = /(?:^|[&&|;(|{}])\s*([@\w\-/]+)/g;
        let match;
        while ((match = commandRegex.exec(script)) !== null) {
          const cmd = match[1];
          if (cmd && !shellCommands.has(cmd)) {
            scriptUsages.add(cmd);
          }
        }

        const execRegex = /(?:npx|pnpm|yarn|npm|bun)\s+(?:exec\s+|run\s+)?([@\w\-/.]+)/g;
        while ((match = execRegex.exec(script)) !== null) {
          const cmd = match[1];
          if (cmd && !shellCommands.has(cmd) && !cmd.startsWith('.') && !cmd.startsWith('/') && !cmd.includes('/') && !cmd.endsWith('.ts') && !cmd.endsWith('.js')) {
            scriptUsages.add(cmd);
          }
        }
      }

      // 1.5. Report Unlisted Binaries
      const BINARY_TO_PACKAGE: Record<string, string> = { 'tsc': 'typescript', 'vitest': 'vitest', 'jest': 'jest', 'eslint': 'eslint', 'prettier': 'prettier', 'oxlint': 'oxlint', 'oxfmt': 'oxfmt', 'tsdown': 'tsdown', 'vite': 'vite', 'rollup': 'rollup', 'webpack': 'webpack', 'esbuild': 'esbuild' };
      for (const bin of scriptUsages) {
        const pkgName = BINARY_TO_PACKAGE[bin] || bin;
        if (!dependencies[pkgName] && !devDependencies[pkgName] && !bin.startsWith('./') && !bin.startsWith('../')) {
          // Check if it's a known global or common binary we should ignore
          const COMMON_GLOBALS = ['sh', 'bash', 'zsh', 'ls', 'cat', 'grep', 'sed', 'awk', 'find', 'curl', 'wget', 'git', 'sudo', 'chmod', 'chown', 'env', 'xargs'];
          if (!COMMON_GLOBALS.includes(bin)) {
            findings.push({
              rule: 'missing-dependency',
              severity: 'error',
              confidence: 'high',
              message: `Binary '${bin}' is used in scripts but not declared in package.json.`,
              file: relativeManifest,
              evidence: { package: bin, type: 'binary' }
            });
          }
        }
      }

      // 2. Audit Dependencies
      for (const dep of Object.keys(dependencies)) {
        // In monorepo, we check if it's used in this package OR if it's a workspace package used elsewhere
        const isUsed = importedInThisPackage.has(dep) || scriptUsages.has(dep);
        if (!isUsed) {
          findings.push({
            rule: 'unused-dependency',
            severity: 'warning',
            confidence: 'high',
            message: `Package '${dep}' is declared as a dependency in ${relativeManifest} but never imported or used in scripts.`,
            file: relativeManifest,
            evidence: { package: dep, type: 'dependency' }
          });
        }
      }

      // 3. Audit DevDependencies
      for (const dep of Object.keys(devDependencies)) {
        // Prevent self-reporting (ignore the package's own name if listed in devDeps)
        if (pkg.name && dep === pkg.name) {
          continue;
        }

        // Special handling for @types/
        if (dep.startsWith('@types/')) {
          const basePkg = dep.slice(7).replace('__', '/');
          if (importedInThisPackage.has(basePkg) || globalImports.has(basePkg) || dependencies[basePkg] || devDependencies[basePkg]) {
            continue; 
          }
        }

        // Refined Whitelist for config/tooling packages
        // We only whitelist very core tools that are almost always implicitly used
        const CORE_TOOLING = [
          'optiprune', 'typescript', 'ts-node', 'tsx', 'babel', 'swc',
          'eslint', 'prettier', 'husky', 'lint-staged',
          'vitest', 'jest', 'cypress', 'playwright',
          '@types/node', '@types/react', '@types/react-dom', '@types/jest'
        ];
        
        const isCoreTool = CORE_TOOLING.some(p => dep.includes(p));
        
        // Heuristic: Check for common config files in root
        const commonConfigs = [
          '.eslintrc', '.prettierrc', 'vitest.config', 'jest.config', 'webpack.config', 'vite.config', 'rollup.config',
          'postcss.config', 'tailwind.config', 'tsconfig.json', 'babel.config', 'swc.config', 'lerna.json', 'turbo.json',
          'nx.json', '.env', 'svelte.config', 'vue.config', 'astro.config', 'package.json'
        ];
        
        const hasRelatedConfig = commonConfigs.some(cfg => {
          const depBase = dep.split('/')[0]?.replace(/^@/, '').replace(/-config$/, '').replace(/config-/, '');
          // If the dependency name (or part of it) is found in a config file name, it's likely used
          return cfg.includes(depBase || '___never___');
        });

        const isUsed = importedInThisPackage.has(dep) || scriptUsages.has(dep) || isCoreTool || hasRelatedConfig;

        if (!isUsed) {
          findings.push({
            rule: 'unused-dev-dependency',
            severity: 'info', // devDeps are usually less critical
            confidence: 'medium',
            message: `DevDependency '${dep}' in ${relativeManifest} appears unused.`,
            file: relativeManifest,
            evidence: { package: dep, type: 'devDependency' }
          });
        }
      }
    }
  }

  // 2. Refine Layer 5 Protection
  for (const module of context.modules.values()) {
    const isReachable = context.reachable.has(module.id) || context.maybeReachable.has(module.id);
    if (!isReachable) {
      for (const exp of module.exports) {
        if (exp.isExternalContract) {
          findings.push({
            rule: 'protected-contract',
            severity: 'info',
            confidence: 'high',
            message: `[Layer 6] Revoked protection for unreferenced contract: ${exp.exportedAs} (File is unreachable).`,
            file: module.relativePath,
            ...(exp.location !== undefined && { location: exp.location }),
            evidence: { symbol: exp.exportedAs, reason: 'unreachable-file' }
          });
          exp.isExternalContract = false;
        }
      }
    }
  }

  return findings;
}