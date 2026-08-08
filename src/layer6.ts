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

export async function parseDtsWithSwc(entryPointRelative: string): Promise<DtsExportGraph> {
  const absolutePath = path.resolve(entryPointRelative);

  if (!fs.existsSync(absolutePath)) {
    return { filePath: absolutePath, exportedTypes: new Set(), hasModuleAugmentation: false };
  }

  const source = fs.readFileSync(absolutePath, 'utf-8');
  const result = yukuParse(source, { lang: 'dts', sourceType: 'module' });
  const program = result.program as any;

  const exportedTypes = new Set<string>();
  let hasModuleAugmentation = false;

  for (const item of (program.body ?? []) as any[]) {
    if (item.type === 'ExportNamedDeclaration') {
      if (item.declaration) {
        const decl = item.declaration as any;
        if (decl.id?.name) {
          exportedTypes.add(decl.id.name);
        }
      }
      for (const spec of (item.specifiers ?? []) as any[]) {
        if (spec.type === 'ExportSpecifier') {
          const name = spec.exported?.name ?? spec.local?.name;
          if (name) exportedTypes.add(name);
        }
      }
    } else if (item.type === 'ExportDefaultDeclaration') {
      exportedTypes.add('default');
    }

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
    } catch (e) {}
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
    } catch (e) {}
  }

  return graph;
}

export async function analyzeLayer6(context: AnalysisContext): Promise<Finding[]> {
  const findings: Finding[] = [];
  const projectRoot = context.options.rootDir;
  
  const lockfileGraph = buildLockfileGraph(projectRoot);
  const packageImportMap = new Map<string, Set<string>>();
  const globalImports = new Set<string>();

  // ---------------------------------------------------------------------------
  // Change 3: @types/node hardcode — if @types/node is installed anywhere in
  // the project, ALL node:* prefixed imports and bare Node built-in names must
  // never be reported as missing dependencies.  We resolve this once up-front
  // so every per-package loop below can consult the flag cheaply.
  // ---------------------------------------------------------------------------
  // Change 3: @types/node hardcode — detect if @types/node is installed
  // We check all modules in the project to see if @types/node exists in any node_modules
  const projectHasTypesNode = Array.from(context.modules.keys()).some(f => {
    const normalized = f.replace(/\\/g, '/');
    return normalized.includes('node_modules/@types/node/') || 
           normalized.endsWith('node_modules/@types/node') ||
           normalized.includes('node_modules/@types/node/index.d.ts');
  });

  const NODE_BUILTINS = new Set([
    'assert', 'async_hooks', 'buffer', 'child_process', 'cluster', 'console', 'constants', 
    'crypto', 'dgram', 'diagnostics_channel', 'dns', 'domain', 'events', 'fs', 'http', 'http2', 
    'https', 'inspector', 'module', 'net', 'os', 'path', 'perf_hooks', 
    'process', 'punycode', 'querystring', 'readline', 'repl', 'stream', 
    'string_decoder', 'sys', 'timers', 'tls', 'trace_events', 'tty', 
    'url', 'util', 'v8', 'vm', 'wasi', 'worker_threads', 'zlib',
    'node:assert', 'node:async_hooks', 'node:buffer', 'node:child_process', 'node:cluster', 'node:console', 
    'node:crypto', 'node:dgram', 'node:dns', 'node:domain', 'node:events', 'node:fs', 'node:http', 
    'node:https', 'node:inspector', 'node:module', 'node:net', 'node:os', 'node:path', 'node:process', 
    'node:punycode', 'node:querystring', 'node:readline', 'node:repl', 'node:stream', 'node:string_decoder', 
    'node:sys', 'node:timers', 'node:tls', 'node:trace_events', 'node:tty', 'node:url', 'node:util', 
    'node:v8', 'node:vm', 'node:wasi', 'node:worker_threads', 'node:zlib'
  ]);

  for (const module of context.modules.values()) {
    let ownerPackage = 'root';
    if (context.options.monorepo) {
      for (const [name, pkg] of context.options.monorepo.packageMap.entries()) {
        // Use POSIX separator '/' instead of path.sep to match pathe-normalized module.id
        const locationPrefix = pkg.location.endsWith('/') ? pkg.location : pkg.location + '/';
        if (module.id.startsWith(locationPrefix) || module.id === pkg.location) {
          ownerPackage = name;
          break;
        }
      }
    }

    const pkgImports = packageImportMap.get(ownerPackage) || new Set<string>();
    if (!packageImportMap.has(ownerPackage)) packageImportMap.set(ownerPackage, pkgImports);

    for (const edge of module.edges) {
      if (edge.resolution === 'external') {
        const specifier = edge.rawSpecifier;
        if (!specifier) continue;

        const cleanSpec = specifier.startsWith('node:') ? specifier.slice(5) : specifier;
        // Change 3: if @types/node is present or it's a node: import, skip it
        if (specifier.startsWith('node:')) continue;
        if (projectHasTypesNode && (NODE_BUILTINS.has(specifier) || NODE_BUILTINS.has(cleanSpec))) {
          continue;
        }

        const parts = cleanSpec.split('/');
        const pkgName = cleanSpec.startsWith('@') ? `${parts[0] ?? ''}/${parts[1] ?? ''}` : (parts[0] ?? '');
        
        if (pkgName && !NODE_BUILTINS.has(pkgName) && !NODE_BUILTINS.has(`node:${pkgName}`)) {
          pkgImports.add(pkgName);
          globalImports.add(pkgName);
        }
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

      const scriptUsages = new Set<string>();
      const scriptPackages = new Set<string>();
      
      // Framework Protection: If a plugin is enabled, protect its core ecosystem
      if (context.enabledPlugins?.has('nextjs-plugin')) {
        scriptPackages.add('next');
        scriptPackages.add('react');
        scriptPackages.add('react-dom');
      }
      if (context.enabledPlugins?.has('nestjs-plugin')) {
        scriptPackages.add('@nestjs/core');
        scriptPackages.add('@nestjs/common');
        scriptPackages.add('reflect-metadata');
        scriptPackages.add('rxjs');
      }
      if (context.enabledPlugins?.has('react-plugin')) {
        scriptPackages.add('react');
        scriptPackages.add('react-dom');
      }
      if (context.enabledPlugins?.has('vuejs-plugin')) {
        scriptPackages.add('vue');
      }
      if (context.enabledPlugins?.has('angular-plugin')) {
        scriptPackages.add('@angular/core');
        scriptPackages.add('@angular/common');
      }

      const shellCommands = new Set(['if', 'then', 'else', 'fi', 'for', 'in', 'do', 'done', 'exit', 'echo', 'cd', 'rm', 'mkdir', 'cp', 'mv', 'node', 'npm', 'pnpm', 'yarn', 'bun', 'run', 'exec', 'test', 'audit', 'install', 'add', 'remove', 'outdated', 'update', 'publish', 'login', 'logout', 'link', 'unlink', 'whoami', 'config', 'info', 'init', 'help', 'version', 'build', 'start', 'stop', 'restart', 'dev', 'serve']);

      const BINARY_TO_PACKAGE: Record<string, string> = { 
        'tsc': 'typescript', 
        'vitest': 'vitest', 
        'jest': 'jest', 
        'eslint': 'eslint', 
        'prettier': 'prettier', 
        'oxlint': 'oxlint', 
        'oxfmt': 'oxfmt', 
        'tsdown': 'tsdown', 
        'vite': 'vite', 
        'rollup': 'rollup', 
        'webpack': 'webpack', 
        'esbuild': 'esbuild',
        'jscpd': 'jscpd',
        'knip': 'knip',
        'husky': 'husky',
        'lint-staged': 'lint-staged',
        'commitlint': '@commitlint/cli'
      };

      for (const script of Object.values(scripts) as string[]) {
        // Improved command detection: 
        // 1. Split by shell operators (&&, ||, ;, |)
        // 2. Extract the first word (the command)
        // 3. Filter out flags, shell built-ins, and relative paths
        const commands = script.split(/[&|;]/);
        for (const fullCmd of commands) {
          const tokens = fullCmd.trim().split(/\s+/);
          const cmd = tokens[0]?.replace(/^["']|["']$/g, '');
          
          if (!cmd || cmd.startsWith('-') || shellCommands.has(cmd) || cmd.startsWith('.') || cmd.startsWith('/') || cmd.includes('/') || cmd.endsWith('.ts') || cmd.endsWith('.js')) {
            continue;
          }

          // Handle package managers: npm run <script>, npx <pkg>
          if (['npx', 'npm', 'pnpm', 'yarn', 'bun'].includes(cmd)) {
            let pkgIndex = 1;
            // Skip 'run' or 'exec' keywords
            if (tokens[pkgIndex] === 'run' || tokens[pkgIndex] === 'exec') {
              pkgIndex++;
            }
            const pkg = tokens[pkgIndex]?.replace(/^["']|["']$/g, '');
            // Skip if it's an internal script or another command/flag
            if (pkg && !pkg.startsWith('-') && !scripts[pkg] && !shellCommands.has(pkg)) {
              scriptUsages.add(pkg);
              scriptPackages.add(BINARY_TO_PACKAGE[pkg] || pkg);
            }
          } else {
            scriptUsages.add(cmd);
            scriptPackages.add(BINARY_TO_PACKAGE[cmd] || cmd);
          }
        }

        if (script.includes('vitest') && script.includes('--coverage')) {
          scriptPackages.add('@vitest/coverage-v8');
          scriptPackages.add('@vitest/coverage-c8');
        }
      }

      const usedNodeBuiltins = new Set<string>();
      const allDeclaredDeps = new Set([...Object.keys(dependencies), ...Object.keys(devDependencies), ...Object.keys(pkg.peerDependencies || {})]);
      
      if (context.options.monorepo && pkgName !== 'root') {
        const rootManifest = manifestPaths.get('root');
        if (rootManifest && fs.existsSync(rootManifest)) {
          try {
            const rootPkg = JSON.parse(fs.readFileSync(rootManifest, 'utf-8'));
            [...Object.keys(rootPkg.dependencies || {}), ...Object.keys(rootPkg.devDependencies || {}), ...Object.keys(rootPkg.peerDependencies || {})].forEach(d => allDeclaredDeps.add(d));
          } catch (e) {}
        }
      }

      for (const imp of importedInThisPackage) {
        const cleanImp = imp.startsWith('node:') ? imp.slice(5) : imp;
        if (imp.startsWith('node:') || NODE_BUILTINS.has(imp) || NODE_BUILTINS.has(cleanImp)) {
          usedNodeBuiltins.add(imp);
          continue;
        }

        // Change 3: if @types/node is installed, node:* built-ins are provided — never flag them
        if (projectHasTypesNode && (imp.startsWith('node:') || NODE_BUILTINS.has(cleanImp))) {
          continue;
        }

        if (!allDeclaredDeps.has(imp) && !imp.startsWith('.') && !imp.startsWith('/') && !imp.includes(':')) {
          findings.push({
            rule: 'missing-dependency',
            severity: 'error',
            confidence: 'high',
            message: `Package '${imp}' is imported but not declared in package.json.`,
            file: relativeManifest,
            evidence: { package: imp, type: 'import' }
          });
        }
      }

      for (const bin of scriptUsages) {
        const pkgName = BINARY_TO_PACKAGE[bin] || bin;
        if (!allDeclaredDeps.has(pkgName) && !bin.startsWith('./') && !bin.startsWith('../')) {
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

      const CORE_TOOLING = [
        'optiprune', '@optiprune/cli', '@optiprune/core', 'typescript', 'ts-node', 'tsx', 'babel', 'swc',
        'eslint', 'prettier', 'husky', 'lint-staged', 'commitlint', 'knip',
        'vitest', 'jest', 'cypress', 'playwright', 'semantic-release',
        '@types/node', '@types/react', '@types/react-dom', '@types/jest'
      ];

      const commonConfigs = [
        '.eslintrc', '.prettierrc', 'vitest.config', 'jest.config', 'webpack.config', 'vite.config', 'rollup.config',
        'postcss.config', 'tailwind.config', 'tsconfig.json', 'babel.config', 'swc.config', 'lerna.json', 'turbo.json',
        'nx.json', '.env', 'svelte.config', 'vue.config', 'astro.config', 'package.json', '.husky', 'knip.json'
      ];

      for (const dep of Object.keys(dependencies)) {
        // Change 1: Plugin priority
        if (context.usedPackages?.has(dep)) continue;

        // Change 3: @types/node hardcode (also for dependencies)
        if (dep === '@types/node') continue;

        // --- IMPROVED HUSKY & TOOLING PROTECTION ---
        const isMarkedUsed = context.usedExports?.has(`${relativeManifest}:dependencies:${dep}`) || 
                             context.usedExports?.has(`${relativeManifest}:devDependencies:${dep}`) ||
                             context.usedExports?.has(`package.json:dependencies:${dep}`) ||
                             context.usedExports?.has(`package.json:devDependencies:${dep}`);

        const isCoreTool = CORE_TOOLING.some(p => dep.toLowerCase().includes(p.toLowerCase()));
        
        // Physical existence check for configs or directories (e.g. .husky)
        const hasRelatedConfig = commonConfigs.some(cfg => {
          const depBase = dep.split('/')[0]?.replace(/^@/, '').replace(/-config$/, '').replace(/config-/, '').replace(/^eslint-plugin-/, '').replace(/^prettier-plugin-/, '');
          if (cfg.includes(depBase || '___never___')) {
             return fs.existsSync(path.join(projectRoot, cfg)) || fs.existsSync(path.join(projectRoot, '.' + depBase));
          }
          return false;
        }) || (dep === 'husky' && fs.existsSync(path.join(projectRoot, '.husky')));

        const isUsed = isMarkedUsed || importedInThisPackage.has(dep) || scriptUsages.has(dep) || scriptPackages.has(dep) || isCoreTool || hasRelatedConfig;
        
        if (!isUsed) {
          findings.push({
            rule: dep,
            severity: 'warning',
            confidence: 'high',
            message: `Package '${dep}' is declared as a dependency in ${relativeManifest} but never imported or used in scripts.`,
            file: relativeManifest,
            evidence: { package: dep, type: 'dependency' }
          });
        }
      }

      for (const dep of Object.keys(devDependencies)) {
        if (pkg.name && dep === pkg.name) {
          continue;
        }

        // Change 1: Plugin priority — plugin-marked packages are unconditionally used
        if (context.usedPackages?.has(dep)) continue;

        if (dep.startsWith('@types/')) {
          const basePkg = dep.slice(7).replace('__', '/');
          // Change 3: @types/node is always considered used when installed — it covers all node:* built-ins
          if (dep === '@types/node') continue;
          if (importedInThisPackage.has(basePkg) || globalImports.has(basePkg) || dependencies[basePkg] || devDependencies[basePkg]) {
            continue; 
          }
        }

        // --- IMPROVED HUSKY & TOOLING PROTECTION ---
        const isMarkedUsed = context.usedExports?.has(`${relativeManifest}:dependencies:${dep}`) || 
                             context.usedExports?.has(`${relativeManifest}:devDependencies:${dep}`) ||
                             context.usedExports?.has(`package.json:dependencies:${dep}`) ||
                             context.usedExports?.has(`package.json:devDependencies:${dep}`);

        const isCoreTool = CORE_TOOLING.some(p => dep.toLowerCase().includes(p.toLowerCase()));
        
        // Physical existence check for configs or directories (e.g. .husky)
        const hasRelatedConfig = commonConfigs.some(cfg => {
          const depBase = dep.split('/')[0]?.replace(/^@/, '').replace(/-config$/, '').replace(/config-/, '').replace(/^eslint-plugin-/, '').replace(/^prettier-plugin-/, '');
          if (cfg.includes(depBase || '___never___')) {
             return fs.existsSync(path.join(projectRoot, cfg)) || fs.existsSync(path.join(projectRoot, '.' + depBase));
          }
          return false;
        }) || (dep === 'husky' && fs.existsSync(path.join(projectRoot, '.husky')));

        const isUsed = isMarkedUsed || importedInThisPackage.has(dep) || scriptUsages.has(dep) || scriptPackages.has(dep) || isCoreTool || hasRelatedConfig;

        let isPluginUsed = false;
        if (!isUsed && (dep.includes('eslint-plugin-') || dep.includes('prettier-plugin-'))) {
          if (scriptPackages.has('eslint') || scriptPackages.has('prettier') || hasRelatedConfig) {
            isPluginUsed = true;
          }
        }

        if (!isUsed && !isPluginUsed) {
          findings.push({
            rule: dep,
            severity: 'info',
            confidence: 'medium',
            message: `DevDependency '${dep}' in ${relativeManifest} appears unused.`,
            file: relativeManifest,
            evidence: { package: dep, type: 'devDependency' }
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