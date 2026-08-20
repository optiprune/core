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
  /** Export usage inferred from a package.json public entry point is deliberately low confidence. */
  usedExportConfidence: Map<string, import("./types.js").Confidence>;
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
  
  // 2. Try tsconfig path aliases. Match the most specific alias first and
  // substitute every wildcard capture in order (`@/*/test/*` is valid), rather
  // than reusing only the first capture.
  if (!target && options.pathAliases.size > 0) {
    const aliases = [...options.pathAliases.entries()].sort(([left], [right]) => {
      const leftWildcards = (left.match(/\*/g) ?? []).length;
      const rightWildcards = (right.match(/\*/g) ?? []).length;
      if (leftWildcards !== rightWildcards) return leftWildcards - rightWildcards;
      return right.length - left.length;
    });

    for (const [alias, targets] of aliases) {
      const wildcardCount = (alias.match(/\*/g) ?? []).length;
      const aliasPattern = alias
        .split("*")
        .map((part) => part.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&"))
        .join("(.*)");
      const match = edge.rawSpecifier.match(new RegExp(`^${aliasPattern}$`));
      if (!match) continue;

      for (const targetPattern of targets) {
        let captureIndex = 1;
        const resolvedSpecifier = targetPattern.replace(/\*/g, () => match[captureIndex++] ?? "");
        const absoluteTarget = path.isAbsolute(resolvedSpecifier)
          ? resolvedSpecifier
          : path.resolve(options.rootDir, options.baseUrl || ".", resolvedSpecifier);
        target = resolveLocalSpecifier(source.id, absoluteTarget, knownFiles, options.extensions);
        if (target) break;
      }
      if (target || wildcardCount === 0) break;
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
        const normalize = (p: string): string => path.resolve(p).replace(/\\/g, "/");

        // Check if the subpath is empty or points to the root directory
        const isRoot = !subPath || subPath === '/' || subPath === '.' || subPath === './';

        if (isRoot) {
          const entries = ['src/index.ts', 'src/index.js', 'index.ts', 'index.js'];
          
          // Build a lookup map of [normalizedPath -> originalKnownFilePath]
          const normalizedKnownMap = new Map<string, string>(
            Array.from(knownFiles).map((f: string) => [normalize(f), f])
          );

          for (const e of entries) {
            const entryPath = normalize(path.join(pkgRoot, e));
            if (normalizedKnownMap.has(entryPath)) {
              target = normalizedKnownMap.get(entryPath);
              break;
            }
          }
        } else {
          // Try the package-local sub-path first. Source repositories often
          // expose TypeScript source while their package export map names the
          // eventual JavaScript artifact.
          const localSpecifier = subPath.startsWith('./') ? subPath : `./${subPath.replace(/^\//, '')}`;
          target = resolveLocalSpecifier(path.join(pkgRoot, "package.json"), localSpecifier, knownFiles, options.extensions);

          // When no built artifact exists, resolve one unambiguous source file
          // by its package-relative sub-path. This supports exports such as
          // `./chart` -> `src/Chart.tsx` without guessing among multiple files.
          if (!target) {
            const requested = subPath.replace(/^\.?\//, "").replace(/\.[^./]+$/, "").toLowerCase();
            const candidatePaths = new Set<string>([
              requested,
              `src/${requested}`,
              `${requested}/index`,
              `src/${requested}/index`,
            ]);

            const pkgRootNorm = normalize(pkgRoot);

            const candidates = Array.from(knownFiles).filter((filePath: string) => {
              const fileNorm = normalize(filePath);
              const relativePath = path.posix.relative(pkgRootNorm, fileNorm);
              const sourcePath = relativePath.replace(/\.[^./]+$/, "").toLowerCase();
              return candidatePaths.has(sourcePath);
            });
            if (candidates.length === 1) target = candidates[0];
          }
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

/**
 * Resolve a concrete runtime import specifier using the same rules as the
 * static graph builder. Layer 4 calls this after its WASM sandbox evaluates a
 * dynamic import expression, including workspace package subpaths.
 */
export function resolveConcreteSpecifier(
  sourceFile: string,
  specifier: string,
  knownFiles: Set<string>,
  options: ResolvedOptions,
): string | undefined {
  const source: ModuleRecord = {
    id: sourceFile,
    relativePath: sourceFile,
    parseStatus: "parsed",
    parseDiagnostics: [],
    sourceText: "",
    exports: [],
    edges: [],
    hasUnknownDynamicBoundary: false,
    hasParseError: false,
    hasUnresolvedCommonJsExports: false,
    scannedDirectories: [],
    dynamicImportCandidates: [],
  };
  const edge: DependencyEdge = {
    source: sourceFile,
    rawSpecifier: specifier,
    kind: "import",
    importedNames: [],
    resolution: "unknown",
  };
  resolveEdge(edge, source, knownFiles, options);
  return edge.target;
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
  ignoreUnknownImport = false,
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
    if (!ignoreUnknownImport && module.hasUnknownDynamicBoundary) {
      hasReachableUnknownDynamicBoundary = true;
    }

    for (const edge of module.edges) {
      if (ignoreUnknownImport && (edge.kind === "dynamic-pattern" || edge.kind === "unknown-dynamic")) {
        continue;
      }
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
    if (!ignoreUnknownImport && reachable.has(module.id)) {
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
    // Keep type-derived accesses separate from direct identifier accesses. The
    // former can safely be associated with an export in this same module.
    const localTypeMemberAccess = new Map<string, Set<string>>();
    const localInstanceTypes = new Map<string, string>();
    const typeNameFromAnnotation = (annotation: any): string | undefined => {
      const typeName = annotation?.typeAnnotation?.typeName ?? annotation?.typeName;
      return typeName?.type === "Identifier" ? typeName.name : undefined;
    };
    const exportedReturnType = (targetModule: ModuleRecord, exportName: string): string | undefined => {
      if (!targetModule.ast) return undefined;
      let result: string | undefined;
      walkAst(targetModule.ast, (node: any) => {
        if (result) return;
        if (node.type === "FunctionDeclaration" && node.id?.name === exportName) {
          result = typeNameFromAnnotation(node.returnType);
          return;
        }
        if (node.type === "VariableDeclarator" && node.id?.type === "Identifier" && node.id.name === exportName) {
          const init = node.init;
          if (init?.type === "ArrowFunctionExpression" || init?.type === "FunctionExpression") {
            result = typeNameFromAnnotation(init.returnType);
          }
        }
      });
      return result;
    };
    // Connect `const value = importedFactory()` with the factory's explicit
    // exported return type so member reads are attributed to that type.
    for (const edge of module.edges) {
      const targetId = edgeTargets(edge)[0];
      const targetModule = targetId ? modules.get(targetId) : undefined;
      if (!targetModule) continue;
      for (const [index, importedName] of edge.importedNames.entries()) {
        const localName = edge.importedLocals?.[index] ?? importedName;
        const returnType = exportedReturnType(targetModule, importedName);
        if (returnType) localInstanceTypes.set(localName, returnType);
      }
    }
    const resolveScopedTypeName = (objectName: string, stack: any[]): string | undefined => {
      // `localTypeMap` is module-wide and can be overwritten when distinct
      // functions reuse a parameter name. Resolve the nearest matching
      // function parameter from the AST stack first to retain lexical scope.
      for (let index = stack.length - 1; index >= 0; index -= 1) {
        const scope = stack[index] as any;
        if (!scope || !["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"].includes(scope.type)) continue;
        for (const parameter of scope.params ?? []) {
          if (parameter?.type !== "Identifier" || parameter.name !== objectName) continue;
          const typeName = parameter.typeAnnotation?.typeAnnotation?.typeName;
          if (typeName?.type === "Identifier") return typeName.name;
        }
      }
      for (let index = stack.length - 1; index >= 0; index -= 1) {
        const scope = stack[index] as any;
        if (scope?.type !== "VariableDeclarator" || scope.id?.type !== "Identifier" || scope.id.name !== objectName) continue;
        const annotation = scope.id.typeAnnotation?.typeAnnotation?.typeName;
        if (annotation?.type === "Identifier") return annotation.name;
        if (scope.init?.type === "NewExpression" && scope.init.callee?.type === "Identifier") return scope.init.callee.name;
      }
      return localInstanceTypes.get(objectName) ?? module.localTypeMap?.[objectName];
    };
    if (module.ast) {
      walkAst(module.ast, (node: any, stack: any[]) => {
        if (node.type === "VariableDeclarator" && node.id?.type === "Identifier" && node.init?.type === "NewExpression" && node.init.callee?.type === "Identifier") {
          localInstanceTypes.set(node.id.name, node.init.callee.name);
        }
        if (node.type === "VariableDeclarator" && node.id?.type === "Identifier" && node.init?.type === "CallExpression" && node.init.callee?.type === "Identifier") {
          const returnType = localInstanceTypes.get(node.init.callee.name);
          if (returnType) localInstanceTypes.set(node.id.name, returnType);
        }

        // Track destructured typed function parameters, e.g.
        // `({ children }: ButtonProps) => ...`.
        if (node.type === "FunctionDeclaration" || node.type === "FunctionExpression" || node.type === "ArrowFunctionExpression") {
          for (const parameter of node.params ?? []) {
            if (parameter?.type !== "ObjectPattern" || !parameter.typeAnnotation) continue;
            const typeName = typeNameFromAnnotation(parameter.typeAnnotation);
            if (!typeName) continue;
            for (const property of parameter.properties ?? []) {
              if ((property.type !== "Property" && property.type !== "ObjectProperty") || property.computed) continue;
              const memberName = property.key?.name ?? property.key?.value;
              if (typeof memberName !== "string") continue;
              if (!localMemberAccess.has(typeName)) localMemberAccess.set(typeName, new Set());
              localMemberAccess.get(typeName)!.add(memberName);
              if (!localTypeMemberAccess.has(typeName)) localTypeMemberAccess.set(typeName, new Set());
              localTypeMemberAccess.get(typeName)!.add(memberName);
            }
          }
        }
        // 1. Track destructured properties (e.g. const { imports, schemaType } = config).
        // Destructuring is equivalent to reading those object members, but it is
        // not represented as a MemberExpression in the AST.
        if (node.type === "VariableDeclarator" && node.id?.type === "ObjectPattern" && node.init?.type === "Identifier") {
          for (const property of node.id.properties ?? []) {
            if ((property.type !== "Property" && property.type !== "ObjectProperty") || property.computed) continue;
            const memberName = property.key?.name ?? property.key?.value;
            if (typeof memberName !== "string") continue;
            const objectName = node.init.name;
            if (!localMemberAccess.has(objectName)) localMemberAccess.set(objectName, new Set());
            localMemberAccess.get(objectName)!.add(memberName);
            const typeName = resolveScopedTypeName(objectName, stack);
            if (typeName) {
              if (!localMemberAccess.has(typeName)) localMemberAccess.set(typeName, new Set());
              localMemberAccess.get(typeName)!.add(memberName);
              if (!localTypeMemberAccess.has(typeName)) localTypeMemberAccess.set(typeName, new Set());
              localTypeMemberAccess.get(typeName)!.add(memberName);
            }
          }
        }

        // 2. Track Member Expressions (e.g., Status.Active, user.id, this.items)
        if (node.type === "MemberExpression" && !node.computed) {
          const propertyName = node.property?.name || node.property?.value;
          if (propertyName) {
            let objectName: string | undefined;
            if (node.object?.type === "Identifier") {
              objectName = node.object.name;
            } else if (node.object?.type === "ThisExpression") {
              // `this.items` has no identifier object. Resolve it against the
              // nearest enclosing class so internal class-member usage reaches
              // the same `usedMembers` key as external `registry.items` access.
              const enclosingClass = [...stack].reverse().find((ancestor: any) =>
                ancestor?.type === "ClassDeclaration" || ancestor?.type === "ClassExpression",
              );
              objectName = enclosingClass?.id?.name;
            }
            if (objectName) {
              // Track direct access (Status.Active, Registry.items, this.items).
              if (!localMemberAccess.has(objectName)) localMemberAccess.set(objectName, new Set());
              localMemberAccess.get(objectName)!.add(propertyName);

              // Track type-aware access (user.id where user is of type User).
              // Preserve a separate map so same-module type usage can later be
              // linked to that module's exported type without overmatching a
              // value identifier that happens to share the type's name.
              const typeName = resolveScopedTypeName(objectName, stack);
              if (typeName) {
                if (!localMemberAccess.has(typeName)) localMemberAccess.set(typeName, new Set());
                localMemberAccess.get(typeName)!.add(propertyName);
                if (!localTypeMemberAccess.has(typeName)) localTypeMemberAccess.set(typeName, new Set());
                localTypeMemberAccess.get(typeName)!.add(propertyName);
              }
              if (node.object?.type === "ThisExpression") {
                if (!localTypeMemberAccess.has(objectName)) localTypeMemberAccess.set(objectName, new Set());
                localTypeMemberAccess.get(objectName)!.add(propertyName);
              }
            }
          }
        }
        

      });
    }

    // Add a self-usage record for locally typed property accesses. This lets
    // an exported type declared in this module retain only the members that
    // local code actually reads. The final propagation pass still requires the
    // export itself to be used before accepting this member usage.
    if (localTypeMemberAccess.size > 0) {
      const current = usage.get(module.id) ?? {
        consumers: new Set<string>(),
        names: new Set<string>(),
        memberAccess: new Map<string, Set<string>>(),
        wildcard: false,
        reExportOnly: true,
      };
      for (const [typeName, members] of localTypeMemberAccess) {
        if (!current.memberAccess.has(typeName)) current.memberAccess.set(typeName, new Set());
        for (const member of members) current.memberAccess.get(typeName)!.add(member);
      }
      usage.set(module.id, current);
    }

    for (const edge of module.edges) {
      for (const target of edgeTargets(edge)) {
        const targetModule = modules.get(target);
        if (!targetModule) continue;
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
        for (const [index, name] of edge.importedNames.entries()) {
          current.names.add(name);
          if (name === "*") {
            current.wildcard = true;
          }

          // Member expressions use the local binding (`Alias.member`), while
          // importedNames stores the exported binding (`Original`). Preserve
          // both keys so aliased imports and legacy edges are handled.
          const localName = edge.importedLocals?.[index] ?? name;
          const accessed = new Set<string>([
            ...(localMemberAccess.get(localName) ?? []),
            ...(localName !== name ? (localMemberAccess.get(name) ?? []) : []),
          ]);
          // A factory import may return an exported interface/class. If the
          // caller reads `theme.colors`, the usage is keyed by the return type
          // (`Theme`), not by the factory name (`createTheme`).
          const returnedType = exportedReturnType(targetModule, name);
          if (returnedType) {
            for (const member of localMemberAccess.get(returnedType) ?? []) accessed.add(member);
          }
          if (accessed.size > 0) {
            const usageKey = returnedType ?? name;
            if (!current.memberAccess.has(usageKey)) current.memberAccess.set(usageKey, new Set());
            for (const m of accessed) current.memberAccess.get(usageKey)!.add(m);
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

export function buildUsedExports(
  modules: Map<string, ModuleRecord>,
  options: ResolvedOptions,
  publicApiEntryPoints: ReadonlySet<string> = new Set<string>(),
): {
  usedExports: Set<string>;
  usedExportConfidence: Map<string, import("./types.js").Confidence>;
  usedMembers: Set<string>;
} {
  const usedExports = new Set<string>();
  const usedExportConfidence = new Map<string, import("./types.js").Confidence>();
  const usedMembers = new Set<string>();
  const importUsage = buildImportUsage(modules);

  // package.json's exports map is a declaration of externally reachable API.
  // It cannot prove that a consumer currently imports a symbol, so retain each
  // direct export with low confidence instead of reporting it as unused.
  for (const moduleId of publicApiEntryPoints) {
    const module = modules.get(moduleId);
    if (!module) continue;
    for (const exp of module.exports) {
      const exportKey = `${moduleId}:${exp.exportedAs}`;
      usedExports.add(exportKey);
      usedExportConfidence.set(exportKey, "low");
    }
  }
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
            const isPublicApiModule = publicApiEntryPoints.has(module.id);
            if (!moduleUsage && !isPublicApiModule) continue;
            const effectiveUsage: ImportUsage = moduleUsage ?? {
              consumers: new Set<string>(),
              names: new Set<string>(),
              memberAccess: new Map<string, Set<string>>(),
              wildcard: false,
              reExportOnly: true,
            };

            for (const exp of targetModule.exports) {
              const exportKey = `${targetId}:${exp.exportedAs}`;
              if (usedExports.has(exportKey)) continue;

              let isUsedViaReExport = false;

              if (edge.kind === 'export-all') {
                // A package entry point that uses export * exposes every target
                // export as part of its public API. This remains low-confidence
                // because the declaration does not prove a concrete consumer.
                const isPublicApiReExport = isPublicApiModule;
                // PRECISION FIX: Only mark this specific export as used if it's actually requested from the barrel
                const isRequested = effectiveUsage.wildcard || effectiveUsage.names.has(exp.exportedAs);
                
                // Also check if it's a default export being requested via a name (not common for export *)
                const isDefaultRequested = exp.isDefault && effectiveUsage.names.has('default');

                if (isPublicApiReExport || isRequested || isDefaultRequested) {
                  isUsedViaReExport = true;
                } else {
                  // DEEP ALIAS FIX for export *
                  // Check if any consumer of 'module' uses this name via wildcard or direct name
                  if (effectiveUsage.wildcard || effectiveUsage.names.has(exp.exportedAs)) {
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
                if (isPublicApiModule || usedExportConfidence.get(`${module.id}:${exp.exportedAs}`) === "low") {
                  usedExportConfidence.set(exportKey, "low");
                }
                changed = true;

                // PROPAGATE MEMBER ACCESS THROUGH RE-EXPORTS
                const accessedInModule = effectiveUsage.memberAccess.get(edge.kind === 'export-all' ? exp.exportedAs : (module.exports.find(e => e.isReExport && e.name === exp.exportedAs)?.exportedAs || ""));
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
          if (internalExport?.isTypeOnly) {
            // Preserve pure type exports referenced by a used public signature.
            // Runtime value exports referenced only inside another export remain
            // eligible for unused-export reporting.
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
            
            // If this local symbol is also a pure type export (e.g. an
            // interface used in a public signature), preserve its usage.
            // Runtime value exports remain independently reportable.
            const internalExport = module.exports.find(e => e.name === current);
            if (internalExport?.isTypeOnly) {
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

  // 4. Local type-member propagation. The import pass above already handles
  // imported types. This final pass also covers access through a parameter or
  // variable whose type is exported from the same module.
  for (const [moduleId, usage] of importUsage) {
    const module = modules.get(moduleId);
    if (!module) continue;

    for (const exp of module.exports) {
      const exportKey = `${moduleId}:${exp.exportedAs}`;
      if (!usedExports.has(exportKey)) continue;

      const accessedMembers = new Set<string>();
      for (const key of [exp.name, exp.exportedAs]) {
        for (const member of usage.memberAccess.get(key) ?? []) {
          accessedMembers.add(member);
        }
      }

      for (const member of accessedMembers) {
        usedMembers.add(`${moduleId}:${exp.exportedAs}:${member}`);
        usedMembers.add(`${moduleId}:${exp.name}:${member}`);
      }
    }
  }

  return { usedExports, usedExportConfidence, usedMembers };
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
  publicApiEntryPoints: ReadonlySet<string> = new Set<string>(),
): GraphBuildResult {
  resolveDependencies(modules, options);
  const components = stronglyConnectedComponents(modules);
  const reachability = calculateReachability(modules, entryPoints, options.ignoreUnknownImport);
  
  // Apply SCC reachability check
  calculateComponentReachability(components, reachability.reachable, reachability.maybeReachable);
  
  const { usedExports, usedExportConfidence, usedMembers } = buildUsedExports(modules, options, publicApiEntryPoints);

  if (options.verbose) {
    console.error(`[Graph] Reachable files: ${reachability.reachable.size}`);
    console.error(`[Graph] Maybe reachable: ${reachability.maybeReachable.size}`);
    console.error(`[Graph] Used exports: ${usedExports.size}`);
    for (const exp of usedExports) {
      console.error(`  - ${exp}`);
    }
  }

  return { components, ...reachability, usedExports, usedExportConfidence, usedMembers };
}

export function contextWithGraph(
  modules: Map<string, ModuleRecord>,
  entryPoints: Set<string>,
  options: ResolvedOptions,
  publicApiEntryPoints: ReadonlySet<string> = new Set<string>(),
): AnalysisContext {
  const graph = buildGraph(modules, entryPoints, options, publicApiEntryPoints);
  return {
    options,
    modules,
    entryPoints,
    reachable: graph.reachable,
    maybeReachable: graph.maybeReachable,
    runtimeUsedFiles: new Set<string>(),
    semanticConfigMembers: new Set<string>(),
    hasReachableUnknownDynamicBoundary: graph.hasReachableUnknownDynamicBoundary,
    components: graph.components,
    usedExports: graph.usedExports,
    usedExportConfidence: graph.usedExportConfidence,
    usedMembers: graph.usedMembers,
    candidateBranches: [],
    dynamicImportCandidates: Array.from(modules.values()).flatMap(m => m.dynamicImportCandidates || []),
    usedPackages: new Set(),
    enabledPlugins: new Set(),
  };
}