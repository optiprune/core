import path from "pathe";
import { resolveDynamicPattern, resolveLocalSpecifier } from "./fs-utils.js";
import { walkAst } from "./parser.js";
import type {
  AnalysisContext,
  DependencyEdge,
  ModuleRecord,
  ResolvedOptions,
  StronglyConnectedComponent,
} from "./types.js";

export interface GraphBuildResult {
  components: StronglyConnectedComponent[];
  reachable: Set<string>;
  maybeReachable: Set<string>;
  hasReachableUnknownDynamicBoundary: boolean;
  usedExports: Set<string>;
  usedMembers: Set<string>;
}

export interface ImportUsage {
  consumers: Set<string>;
  names: Set<string>;
  memberAccess: Map<string, Set<string>>; // Added for Member-Level Analysis: exportName -> Set of memberNames
  wildcard: boolean;
  reExportOnly: boolean;
}

function dynamicParts(rawSpecifier: string): { prefix: string; suffix: string } | undefined {
  const marker = "${…}";
  const index = rawSpecifier.indexOf(marker);
  if (index < 0) {
    return undefined;
  }
  return {
    prefix: rawSpecifier.slice(0, index),
    suffix: rawSpecifier.slice(index + marker.length),
  };
}

function resolveEdge(
  edge: DependencyEdge,
  source: ModuleRecord,
  knownFiles: Set<string>,
  options: ResolvedOptions,
): void {
  if (edge.kind === "unknown-dynamic") {
    edge.resolution = "unknown";
    return;
  }

  if (edge.kind === "dynamic-pattern") {
    const parts = edge.dynamicPattern || dynamicParts(edge.rawSpecifier);
    if (!parts) {
      edge.resolution = "unknown";
      return;
    }
    const candidates = resolveDynamicPattern(source.id, parts.prefix, parts.suffix, knownFiles);
    const baseDirectory = path.resolve(path.dirname(source.id), parts.prefix || ".");
    edge.dynamicPattern = {
      prefix: parts.prefix,
      suffix: parts.suffix,
      baseDirectory,
      candidates,
    };
    edge.resolution = candidates.length > 0 ? "resolved" : "unresolved";
    return;
  }

  // 1. Try local resolution
  let target = resolveLocalSpecifier(source.id, edge.rawSpecifier, knownFiles, options.extensions);
  if (edge.rawSpecifier.startsWith(".")) {
    // console.log("Resolving " + edge.rawSpecifier + " from " + source.id + " -> " + target);
  }
  
  // 2. Try tsconfig path aliases
  if (!target && options.pathAliases.size > 0) {
    for (const [alias, targets] of options.pathAliases.entries()) {
      const aliasPattern = alias.replace(/\*/g, "(.*)");
      const matcher = new RegExp(`^${aliasPattern}$`);
      const match = edge.rawSpecifier.match(matcher);

      if (match) {
        for (const targetPattern of targets) {
          const resolvedSpecifier = targetPattern.replace(/\*/g, match[1] || "");
          const absoluteTarget = path.resolve(options.rootDir, options.baseUrl || ".", resolvedSpecifier);
          target = resolveLocalSpecifier(source.id, absoluteTarget, knownFiles, options.extensions);
          if (target) break;
        }
      }
      if (target) break;
    }
  }

  // 3. Try baseUrl resolution (non-relative imports)
  if (!target && options.baseUrl && !edge.rawSpecifier.startsWith(".") && !path.isAbsolute(edge.rawSpecifier)) {
    const absoluteTarget = path.resolve(options.rootDir, options.baseUrl, edge.rawSpecifier);
    target = resolveLocalSpecifier(source.id, absoluteTarget, knownFiles, options.extensions);
  }

  // 4. Try Monorepo Workspace resolution
  if (!target && options.monorepo) {
    // Check if the specifier starts with a workspace package name
    for (const [pkgName, pkg] of options.monorepo.packageMap.entries()) {
      if (edge.rawSpecifier === pkgName || edge.rawSpecifier.startsWith(pkgName + '/')) {
        // Resolve to the package's entry point (main/exports)
        // For simplicity, we assume index.ts/js in the package root or src
        const subPath = edge.rawSpecifier.slice(pkgName.length);
        const pkgRoot = pkg.location;
        
        // Try common entry points if it's just the package name
        if (!subPath || subPath === '/') {
          const entries = ['src/index.ts', 'src/index.js', 'index.ts', 'index.js'];
          for (const e of entries) {
            const entryPath = path.join(pkgRoot, e);
            if (knownFiles.has(entryPath)) {
              target = entryPath;
              break;
            }
          }
        } else {
          // Try resolving the sub-path
          target = resolveLocalSpecifier(path.join(pkgRoot, 'package.json'), '.' + subPath, knownFiles, options.extensions);
        }
        
        if (target) break;
      }
    }
  }

  if (target) {
    edge.target = target;
    edge.resolution = "resolved";
  } else if (edge.rawSpecifier.startsWith(".") || edge.rawSpecifier.startsWith("/") || edge.rawSpecifier.startsWith("file:")) {
    edge.resolution = "unresolved";
  } else {
    edge.resolution = "external";
  }
}

export function resolveDependencies(modules: Map<string, ModuleRecord>, options: ResolvedOptions): void {
  const knownFiles = new Set(modules.keys());
  for (const module of modules.values()) {
    for (const edge of module.edges) {
      resolveEdge(edge, module, knownFiles, options);
    }
  }
}

export function edgeTargets(edge: DependencyEdge): string[] {
  if (edge.target) {
    return [edge.target];
  }
  return edge.dynamicPattern?.candidates ?? [];
}

function adjacencyFor(modules: Map<string, ModuleRecord>, moduleId: string): string[] {
  const module = modules.get(moduleId);
  if (!module) {
    return [];
  }
  return module.edges.flatMap(edgeTargets).filter((target) => modules.has(target));
}

function reverseAdjacency(modules: Map<string, ModuleRecord>): Map<string, string[]> {
  const reverse = new Map<string, string[]>();
  for (const moduleId of modules.keys()) {
    reverse.set(moduleId, []);
  }
  for (const module of modules.values()) {
    for (const target of module.edges.flatMap(edgeTargets)) {
      const reverseTargets = reverse.get(target);
      if (reverseTargets) {
        reverseTargets.push(module.id);
      }
    }
  }
  return reverse;
}

/** Kosaraju with explicit stacks avoids stack overflows on deep graphs and cycles. */
export function stronglyConnectedComponents(modules: Map<string, ModuleRecord>): StronglyConnectedComponent[] {
  const visited = new Set<string>();
  const finishOrder: string[] = [];

  for (const root of modules.keys()) {
    if (visited.has(root)) {
      continue;
    }
    const stack: Array<{ moduleId: string; nextIndex: number; neighbors: string[] }> = [];
    visited.add(root);
    stack.push({ moduleId: root, nextIndex: 0, neighbors: adjacencyFor(modules, root) });

    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      if (!frame) {
        break;
      }
      if (frame.nextIndex < frame.neighbors.length) {
        const neighbor = frame.neighbors[frame.nextIndex];
        frame.nextIndex += 1;
        if (neighbor && !visited.has(neighbor)) {
          visited.add(neighbor);
          stack.push({ moduleId: neighbor, nextIndex: 0, neighbors: adjacencyFor(modules, neighbor) });
        }
      } else {
        finishOrder.push(frame.moduleId);
        stack.pop();
      }
    }
  }

  const reverse = reverseAdjacency(modules);
  const assigned = new Set<string>();
  const components: StronglyConnectedComponent[] = [];

  while (finishOrder.length > 0) {
    const root = finishOrder.pop();
    if (!root || assigned.has(root)) {
      continue;
    }
    const members: string[] = [];
    const stack = [root];
    assigned.add(root);
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) {
        continue;
      }
      members.push(current);
      for (const neighbor of reverse.get(current) ?? []) {
        if (!assigned.has(neighbor)) {
          assigned.add(neighbor);
          stack.push(neighbor);
        }
      }
    }
    members.sort((left, right) => left.localeCompare(right));
    const selfLoop = members.length === 1 && adjacencyFor(modules, members[0] ?? "").includes(members[0] ?? "");
    components.push({
      id: components.length,
      modules: members,
      isCycle: members.length > 1 || selfLoop,
    });
  }

  return components;
}

type ReachabilityCertainty = "exact" | "maybe";

interface ReachabilityWorkItem {
  moduleId: string;
  certainty: ReachabilityCertainty;
}

/**
 * Traverse the graph iteratively. Pattern imports and edges extracted from malformed files
 * propagate `maybe` reachability. A reachable completely unknown dynamic boundary makes every
 * project module only maybe-reachable, preventing unsafe unreachable-file claims.
 */
export function calculateReachability(
  modules: Map<string, ModuleRecord>,
  entryPoints: Set<string>,
): Pick<GraphBuildResult, "reachable" | "maybeReachable" | "hasReachableUnknownDynamicBoundary"> {
  const reachable = new Set<string>();
  const maybeReachable = new Set<string>();
  const queue: ReachabilityWorkItem[] = [...entryPoints].map((moduleId) => ({ moduleId, certainty: "exact" }));
  let cursor = 0;
  let hasReachableUnknownDynamicBoundary = false;

  while (cursor < queue.length) {
    const current = queue[cursor];
    cursor += 1;
    if (!current || !modules.has(current.moduleId)) {
      continue;
    }

    if (current.certainty === "exact") {
      if (reachable.has(current.moduleId)) {
        continue;
      }
      reachable.add(current.moduleId);
      maybeReachable.delete(current.moduleId);
    } else if (reachable.has(current.moduleId) || maybeReachable.has(current.moduleId)) {
      continue;
    } else {
      maybeReachable.add(current.moduleId);
    }

    const module = modules.get(current.moduleId);
    if (!module) {
      continue;
    }
    if (module.hasUnknownDynamicBoundary) {
      hasReachableUnknownDynamicBoundary = true;
    }

    for (const edge of module.edges) {
      // Type-only imports DO contribute to file reachability, but not necessarily runtime usage
      // The `isTypeOnly` flag is preserved on the edge for later analysis.
      // If a module has a parse error, we treat its edges as "maybe" because the AST might be incomplete.
      const edgeIsMaybe = edge.kind === "dynamic-pattern" || module.hasParseError;
      const childCertainty: ReachabilityCertainty =
        current.certainty === "maybe" || edgeIsMaybe ? "maybe" : "exact";
      for (const target of edgeTargets(edge)) {
        queue.push({ moduleId: target, certainty: childCertainty });
      }
    }
  }

  // Generic Dynamic Discovery:
  // If a reachable module scans a directory (readdir) and also has dynamic import patterns,
  // we assume it's a plugin loader and mark all files in that directory as maybe-reachable.
  for (const module of modules.values()) {
    if (reachable.has(module.id)) {
      const hasDynamicPatterns = module.edges.some(e => e.kind === "dynamic-pattern" || e.kind === "unknown-dynamic");
      const hasScannedDirs = module.scannedDirectories && module.scannedDirectories.length > 0;
      
      if (hasDynamicPatterns && (hasScannedDirs || module.hasUnknownDynamicBoundary)) {
        if (hasScannedDirs) {
          for (const dir of module.scannedDirectories) {
            // Resolve the scanned directory relative to the module
            const absoluteDir = path.resolve(path.dirname(module.id), dir);
            for (const candidate of modules.keys()) {
              if (!reachable.has(candidate) && !maybeReachable.has(candidate)) {
                if (candidate.startsWith(absoluteDir)) {
                  maybeReachable.add(candidate);
                }
              }
            }
          }
        }
        
        // If we have an unknown dynamic boundary (like a variable readdir or unknown import),
        // we must be conservative to ensure "World Peace" and not flag unreachable files
        // that might be part of this dynamic system.
        if (module.hasUnknownDynamicBoundary) {
          hasReachableUnknownDynamicBoundary = true;
        }
      }
    }
  }

  if (hasReachableUnknownDynamicBoundary) {
    for (const moduleId of modules.keys()) {
      if (!reachable.has(moduleId)) {
        maybeReachable.add(moduleId);
      }
    }
  }

  return { reachable, maybeReachable, hasReachableUnknownDynamicBoundary };
}

export function buildImportUsage(modules: Map<string, ModuleRecord>): Map<string, ImportUsage> {
  const usage = new Map<string, ImportUsage>();
  for (const module of modules.values()) {
    // Member Access Tracking within the module
    const localMemberAccess = new Map<string, Set<string>>();
    if (module.ast) {
      walkAst(module.ast, (node: any, stack: any[]) => {
        // 1. Track Member Expressions (e.g., Status.Active, user.id)
        if (node.type === "MemberExpression" && node.object.type === "Identifier" && !node.computed) {
          const objectName = node.object.name;
          const propertyName = node.property.name || node.property.value;
          if (propertyName) {
            // Track direct access (Status.Active)
            if (!localMemberAccess.has(objectName)) localMemberAccess.set(objectName, new Set());
            localMemberAccess.get(objectName)!.add(propertyName);

            // Track type-aware access (user.id where user is of type User)
            const typeName = module.localTypeMap?.[objectName];
            if (typeName) {
              if (!localMemberAccess.has(typeName)) localMemberAccess.set(typeName, new Set());
              localMemberAccess.get(typeName)!.add(propertyName);
            }
          }
        }
        

      });
    }

    for (const edge of module.edges) {
      for (const target of edgeTargets(edge)) {
        const current = usage.get(target) ?? { 
          consumers: new Set<string>(), 
          names: new Set<string>(), 
          memberAccess: new Map<string, Set<string>>(),
          wildcard: false,
          reExportOnly: true 
        };
        current.consumers.add(module.id);
        const isReExport = edge.kind === "export-all" || edge.kind === "export-from";
        if (!isReExport) {
          current.reExportOnly = false;
        }
        for (const name of edge.importedNames) {
          current.names.add(name);
          if (name === "*") {
            current.wildcard = true;
          }
          
          // Map local member access to the imported name
          const accessed = localMemberAccess.get(name);
          if (accessed) {
            if (!current.memberAccess.has(name)) current.memberAccess.set(name, new Set());
            for (const m of accessed) current.memberAccess.get(name)!.add(m);
          }
        }
        if (edge.kind === "dynamic-pattern") {
          current.wildcard = true;
        }
        usage.set(target, current);
      }
    }

    // Mark exports as used if they are referenced locally within the module
    for (const exportRecord of module.exports) {
      if (module.localReferences && module.localReferences.includes(exportRecord.name)) {
        const current = usage.get(module.id) ?? { 
          consumers: new Set<string>(), 
          names: new Set<string>(), 
          memberAccess: new Map<string, Set<string>>(),
          wildcard: false,
          reExportOnly: true 
        };
        current.names.add(exportRecord.exportedAs);
        // Note: We keep reExportOnly = true here to not block unused-export detection 
        // if this is the ONLY usage.
        usage.set(module.id, current);
      }
    }
  }
  return usage;
}

export function buildUsedExports(modules: Map<string, ModuleRecord>, options: ResolvedOptions): { usedExports: Set<string>, usedMembers: Set<string> } {
  const usedExports = new Set<string>();
  const usedMembers = new Set<string>();
  const importUsage = buildImportUsage(modules);
  // 1. Initial pass: Mark exports used by non-re-export imports
  // and resolve explicit re-exports (export { x } from 'mod')
  const worklist: Array<{ moduleId: string, name: string }> = [];
  for (const [targetId, usage] of importUsage.entries()) {
    const targetModule = modules.get(targetId);
    if (!targetModule) continue;

    if (options.verbose) {
      console.error(`[Graph] Processing module ${targetId}`);
      console.error(`  - Consumers: ${Array.from(usage.consumers).join(', ')}`);
      console.error(`  - reExportOnly: ${usage.reExportOnly}`);
    }

    for (const exp of targetModule.exports) {
      if (exp.isExternalContract) {
        usedExports.add(`${targetId}:${exp.exportedAs}`);
        continue;
      }

      // SELF-IMPORT FIX: Check if there are consumers OTHER than the module itself.
      // If a file imports from itself, that shouldn't count as an external usage.
      const hasExternalConsumers = Array.from(usage.consumers).some(c => c !== targetId);

      // If it's a direct import (not a re-export)
      if (!usage.reExportOnly && hasExternalConsumers) {
        const isRequested = usage.wildcard || usage.names.has(exp.exportedAs) || (exp.isDefault && usage.names.has('default'));
        if (isRequested) {
          if (!usedExports.has(`${targetId}:${exp.exportedAs}`)) {
            usedExports.add(`${targetId}:${exp.exportedAs}`);
            worklist.push({ moduleId: targetId, name: exp.exportedAs });
          }
          
          // Track member access
          const accessed = usage.memberAccess.get(exp.exportedAs);
          
          if (accessed) {
            for (const m of accessed) {
              
              usedMembers.add(`${targetId}:${exp.exportedAs}:${m}`);
            }
          }
        }
      }
    }
  }

  // 2. Propagation pass: Follow re-export chains
  // This handles: App -> Barrel (export * from 'Lib') -> Lib
  let changed = true;
  while (changed) {
    changed = false;
    for (const module of modules.values()) {
      for (const edge of module.edges) {
        if (edge.kind === 'export-all' || edge.kind === 'export-from') {
          for (const targetId of edgeTargets(edge)) {
            const targetModule = modules.get(targetId);
            if (!targetModule) continue;

            // If someone uses an export from 'module', and 'module' re-exports it from 'targetModule'
            const moduleUsage = importUsage.get(module.id);
            if (!moduleUsage) continue;

            for (const exp of targetModule.exports) {
              const exportKey = `${targetId}:${exp.exportedAs}`;
              if (usedExports.has(exportKey)) continue;

              let isUsedViaReExport = false;

              if (edge.kind === 'export-all') {
                // PRECISION FIX: Only mark this specific export as used if it's actually requested from the barrel
                const isRequested = moduleUsage.wildcard || moduleUsage.names.has(exp.exportedAs);
                
                // Also check if it's a default export being requested via a name (not common for export *)
                const isDefaultRequested = exp.isDefault && moduleUsage.names.has('default');

                if (isRequested || isDefaultRequested) {
                  isUsedViaReExport = true;
                } else {
                  // DEEP ALIAS FIX for export *
                  // Check if any consumer of 'module' uses this name via wildcard or direct name
                  if (moduleUsage.wildcard || moduleUsage.names.has(exp.exportedAs)) {
                    isUsedViaReExport = true;
                  }
                }
              } else if (edge.kind === 'export-from') {
                // Explicit re-export: export { x } from 'mod'
                // edge.importedNames contains the names from 'targetModule'
                // We need to see if the corresponding exported name in 'module' is used
                for (const edgeImportName of edge.importedNames) {
                   if (edgeImportName === exp.exportedAs || (exp.isDefault && edgeImportName === 'default')) {
                     // Find the name this is exported as in 'module'
                     const correspondingExport = module.exports.find(e => e.isReExport && e.name === edgeImportName);
                     if (correspondingExport) {
                       const exportKeyInModule = `${module.id}:${correspondingExport.exportedAs}`;
                       if (usedExports.has(exportKeyInModule)) {
                         isUsedViaReExport = true;
                         break;
                       }
                       
                       // DEEP ALIAS FIX: If this re-export is itself re-exported further, 
                       // the usage might be further down the chain.
                       // We check if any consumer of 'module' uses this specific exported name.
                       const moduleUsage = importUsage.get(module.id);
                       if (moduleUsage && (moduleUsage.wildcard || moduleUsage.names.has(correspondingExport.exportedAs))) {
                         isUsedViaReExport = true;
                         break;
                       }
                     }
                   }
                }
              }

              if (isUsedViaReExport) {
                usedExports.add(exportKey);
                changed = true;

                // PROPAGATE MEMBER ACCESS THROUGH RE-EXPORTS
                const accessedInModule = moduleUsage.memberAccess.get(edge.kind === 'export-all' ? exp.exportedAs : (module.exports.find(e => e.isReExport && e.name === exp.exportedAs)?.exportedAs || ""));
                if (accessedInModule) {
                  for (const m of accessedInModule) {
                    usedMembers.add(`${targetId}:${exp.exportedAs}:${m}`);
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  // 3. Local Symbol Propagation (Fix 3: TypeScript False Positives)
  // This handles two things:
  // A) If an export A is used, any local symbol B it references must also be used.
  // B) INTERNAL REFERENCE FIX: Symbols used in top-level code (captured under "")
  changed = true;
  while (changed) {
    changed = false;
    for (const module of modules.values()) {
      const localDeps = module.localSymbolMap || {};
      
      // INTERNAL REFERENCE FIX: Symbols used in top-level code
      // We only mark internal exports as used if the module itself is reachable.
      // If the module is unreachable, its internal references don't matter.
      const isReachable = usedExports.size > 0 && Array.from(usedExports).some(k => k.startsWith(`${module.id}:`));
      
      if (isReachable) {
        const topLevelRefs = localDeps[""] || [];
        for (const refName of topLevelRefs) {
          const internalExport = module.exports.find(e => e.name === refName);
          if (internalExport) {
            const internalKey = `${module.id}:${internalExport.exportedAs}`;
            if (!usedExports.has(internalKey)) {
              usedExports.add(internalKey);
              changed = true;
            }
          }
        }
      }
      
      for (const exp of module.exports) {
        const exportKey = `${module.id}:${exp.exportedAs}`;
        if (usedExports.has(exportKey)) {
          const queue = [...(exp.localReferences || [])];
          const visited = new Set<string>();
          
          while (queue.length > 0) {
            const current = queue.shift()!;
            if (!current || visited.has(current)) continue;
            visited.add(current);
            
            // If this local symbol is also an export (e.g. an Interface used as a type)
            const internalExport = module.exports.find(e => e.name === current);
            if (internalExport) {
              const internalKey = `${module.id}:${internalExport.exportedAs}`;
              if (!usedExports.has(internalKey)) {
                usedExports.add(internalKey);
                changed = true;
              }
            }
            
            // Propagate to symbols used by this symbol
            const deps = localDeps[current];
            if (Array.isArray(deps)) {
              queue.push(...deps);
            }
          }
        }
      }
    }
  }

  return { usedExports, usedMembers };
}

/**
 * Refines component reachability. A component is reachable if at least one of its
 * modules is reachable from an entry point.
 */
/**
 * Refines component reachability. A component is reachable if at least one of its
 * modules is reachable from an entry point.
 */
export function calculateComponentReachability(
  components: StronglyConnectedComponent[],
  reachable: Set<string>,
  maybeReachable: Set<string>
): void {
  for (const comp of components) {
    // A component is reachable if ANY of its modules are in the reachable set
    comp.isReachable = comp.modules.some(m => reachable.has(m));
    // A component is maybe reachable if ANY of its modules are in the maybeReachable set
    // OR if it's not reachable but one of its modules is reachable via a maybe-path
    comp.isMaybeReachable = comp.modules.some(m => maybeReachable.has(m));
  }
}

export function buildGraph(
  modules: Map<string, ModuleRecord>,
  entryPoints: Set<string>,
  options: ResolvedOptions,
): GraphBuildResult {
  resolveDependencies(modules, options);
  const components = stronglyConnectedComponents(modules);
  const reachability = calculateReachability(modules, entryPoints);
  
  // Apply SCC reachability check
  calculateComponentReachability(components, reachability.reachable, reachability.maybeReachable);
  
  const { usedExports, usedMembers } = buildUsedExports(modules, options);

  if (options.verbose) {
    console.error(`[Graph] Reachable files: ${reachability.reachable.size}`);
    console.error(`[Graph] Maybe reachable: ${reachability.maybeReachable.size}`);
    console.error(`[Graph] Used exports: ${usedExports.size}`);
    for (const exp of usedExports) {
      console.error(`  - ${exp}`);
    }
  }

  return { components, ...reachability, usedExports, usedMembers };
}

export function contextWithGraph(
  modules: Map<string, ModuleRecord>,
  entryPoints: Set<string>,
  options: ResolvedOptions,
): AnalysisContext {
  const graph = buildGraph(modules, entryPoints, options);
  return {
    options,
    modules,
    entryPoints,
    reachable: graph.reachable,
    maybeReachable: graph.maybeReachable,
    hasReachableUnknownDynamicBoundary: graph.hasReachableUnknownDynamicBoundary,
    components: graph.components,
    usedExports: graph.usedExports,
    usedMembers: graph.usedMembers,
    candidateBranches: [],
    dynamicImportCandidates: Array.from(modules.values()).flatMap(m => m.dynamicImportCandidates || []),
    usedPackages: new Set(),
    enabledPlugins: new Set(),
  };
}
