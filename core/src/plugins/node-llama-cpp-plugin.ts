import type { AnalyzerPlugin, Finding, PluginAdapter } from "../types.js";
import { t } from "../ast-utils.js";

const PACKAGE_NAME = "node-llama-cpp";
const SERVER_PARAMETER_NAMES = new Set([
  "req",
  "res",
  "request",
  "response",
  "reply",
  "ctx",
  "context",
  "socket",
  "event",
]);
const SERVER_METHODS = new Set([
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "all",
  "use",
  "route",
  "handle",
  "on",
  "listen",
]);

type ResourceKind = "llama" | "model" | "context" | "sequence" | "session";

interface Origin {
  key: string;
  kind: ResourceKind;
  name: string;
  file: string;
  scope: string;
  contextKey?: string;
  sequenceName?: string;
}

interface ContextResource extends Origin {
  kind: "context";
  contextSize?: number;
  batchSize?: number;
  sequences: number;
  sequenceCount: number;
  disposed: boolean;
  disposedInFinally: boolean;
  usingManaged: boolean;
}

interface SessionResource extends Origin {
  kind: "session";
  contextKey?: string;
  sequenceName?: string;
}

interface FileState {
  origins: Map<string, Origin>;
  contexts: Map<string, ContextResource>;
  sessions: Map<string, SessionResource>;
  importedGetLlamaNames: Set<string>;
  importedSessionNames: Set<string>;
  emitted: Set<string>;
}

const stateByFile = new Map<string, FileState>();
let packageDeclared = false;
let reportedMissingDependency = false;

function stateFor(file: string): FileState {
  let state = stateByFile.get(file);
  if (!state) {
    state = {
      origins: new Map(),
      contexts: new Map(),
      sessions: new Map(),
      importedGetLlamaNames: new Set(["getLlama"]),
      importedSessionNames: new Set(["LlamaChatSession"]),
      emitted: new Set(),
    };
    stateByFile.set(file, state);
  }
  return state;
}

function nodeName(node: any): string | undefined {
  if (t.isIdentifier(node)) return node.name;
  if (t.isStringLiteral(node) || t.isLiteral(node))
    return typeof node.value === "string" ? node.value : undefined;
  return undefined;
}

function propertyName(member: any): string | undefined {
  if (!member || (member.type !== "MemberExpression" && member.type !== "OptionalMemberExpression"))
    return undefined;
  if (!member.computed) return nodeName(member.property);
  return nodeName(member.property);
}

function memberCall(expression: any): { object: any; method: string; call: any } | undefined {
  const call = unwrapAwait(expression);
  if (!t.isCallExpression(call) && call?.type !== "OptionalCallExpression") return undefined;
  const method = propertyName(call.callee);
  if (!method) return undefined;
  return { object: call.callee.object, method, call };
}

function unwrapAwait(expression: any): any {
  let current = expression;
  while (
    current &&
    ["AwaitExpression", "TSAsExpression", "TSTypeAssertion", "TSNonNullExpression"].includes(
      current.type,
    )
  ) {
    current = current.argument ?? current.expression;
  }
  return current;
}

function functionScope(ancestors: any[]): string {
  const functionNode = [...ancestors]
    .reverse()
    .find(
      (node) =>
        node &&
        [
          "FunctionDeclaration",
          "FunctionExpression",
          "ArrowFunctionExpression",
          "ObjectMethod",
          "ClassMethod",
        ].includes(node.type),
    );
  if (!functionNode) return "module";
  const name = functionNode.id?.name ?? functionNode.key?.name ?? "anonymous";
  return `function:${name}@${functionNode.start ?? "unknown"}`;
}

function originKey(scope: string, name: string): string {
  return `${scope}::${name}`;
}

function getOrigin(state: FileState, name: string, scope: string): Origin | undefined {
  return state.origins.get(originKey(scope, name)) ?? state.origins.get(originKey("module", name));
}

function setOrigin(state: FileState, origin: Origin): void {
  state.origins.set(origin.key, origin);
}

function isUsingDeclaration(ancestors: any[]): boolean {
  return ancestors.some(
    (node) =>
      node?.type === "VariableDeclaration" &&
      typeof node.kind === "string" &&
      node.kind.includes("using"),
  );
}

function rangeContains(container: any, node: any): boolean {
  return (
    typeof container?.start === "number" &&
    typeof container?.end === "number" &&
    typeof node?.start === "number" &&
    typeof node?.end === "number" &&
    container.start <= node.start &&
    container.end >= node.end
  );
}

function isInsideFinally(node: any, ancestors: any[]): boolean {
  return ancestors.some(
    (ancestor) => ancestor?.type === "TryStatement" && rangeContains(ancestor.finalizer, node),
  );
}

function isRequestScopedHandler(ancestors: any[]): boolean {
  const functionNode = [...ancestors]
    .reverse()
    .find(
      (node) =>
        node &&
        ["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"].includes(
          node.type,
        ),
    );
  const hasRequestParameter = !!functionNode?.params?.some((parameter: any) => {
    const name = nodeName(parameter);
    return !!name && SERVER_PARAMETER_NAMES.has(name);
  });
  if (hasRequestParameter) return true;

  return ancestors.some((node) => {
    if (!t.isCallExpression(node)) return false;
    const method = propertyName(node.callee);
    return !!method && SERVER_METHODS.has(method);
  });
}

function objectProperty(object: any, key: string): any | undefined {
  if (!t.isObjectExpression(object)) return undefined;
  return object.properties?.find((property: any) => {
    if (!property || (property.type !== "Property" && property.type !== "ObjectProperty"))
      return false;
    return nodeName(property.key) === key;
  })?.value;
}

function numericLiteral(node: any): number | undefined {
  const value = unwrapAwait(node);
  if (typeof value?.value === "number" && Number.isFinite(value.value)) return value.value;
  if (
    value?.type === "UnaryExpression" &&
    value.operator === "-" &&
    typeof value.argument?.value === "number"
  )
    return -value.argument.value;
  return undefined;
}

function emitOnce(
  state: FileState,
  adapter: PluginAdapter,
  key: string,
  finding: Omit<Finding, "rule"> & { rule?: string },
): void {
  if (state.emitted.has(key)) return;
  state.emitted.add(key);
  adapter.emitFinding(finding);
}

function locationOf(node: any) {
  if (!node?.loc?.start || !node?.loc?.end) return undefined;
  return { start: node.loc.start, end: node.loc.end };
}

function resolveOrigin(state: FileState, node: any, scope: string): Origin | undefined {
  const expression = unwrapAwait(node);
  if (t.isIdentifier(expression)) return getOrigin(state, expression.name, scope);

  const call = memberCall(expression);
  if (call?.method === "getSequence" && t.isIdentifier(call.object)) {
    const context = getOrigin(state, call.object.name, scope);
    if (context?.kind === "context") {
      return {
        key: originKey(scope, `${call.object.name}.getSequence()`),
        kind: "sequence",
        name: `${call.object.name}.getSequence()`,
        file: context.file,
        scope,
        contextKey: context.key,
      };
    }
  }
  return undefined;
}

function reportMissingDependency(file: string, state: FileState, adapter: PluginAdapter): void {
  if (packageDeclared || reportedMissingDependency) return;
  reportedMissingDependency = true;
  emitOnce(state, adapter, `missing-dependency:${file}`, {
    rule: "missing-dependency",
    severity: "error",
    confidence: "high",
    file: "package.json",
    message:
      "node-llama-cpp is imported by the project but is not declared in package.json dependencies, devDependencies, or peerDependencies.",
    evidence: { package: PACKAGE_NAME, importedFrom: file },
  });
}

function registerImport(node: any, file: string, state: FileState, adapter: PluginAdapter): void {
  if (t.isImportDeclaration(node) && node.source?.value === PACKAGE_NAME) {
    adapter.markPackageAsUsed(PACKAGE_NAME);
    reportMissingDependency(file, state, adapter);
    for (const specifier of node.specifiers ?? []) {
      const imported = nodeName(specifier.imported) ?? nodeName(specifier.local);
      const local = nodeName(specifier.local) ?? imported;
      if (!local) continue;
      if (imported === "getLlama") state.importedGetLlamaNames.add(local);
      if (imported === "LlamaChatSession") state.importedSessionNames.add(local);
    }
    return;
  }

  if (!t.isCallExpression(node) || !t.isIdentifier(node.callee) || node.callee.name !== "require")
    return;
  const required = nodeName(node.arguments?.[0]);
  if (required !== PACKAGE_NAME) return;
  adapter.markPackageAsUsed(PACKAGE_NAME);
  reportMissingDependency(file, state, adapter);
}

function auditContextOptions(
  file: string,
  declaration: any,
  options: any,
  context: ContextResource,
  state: FileState,
  adapter: PluginAdapter,
): void {
  if (!t.isObjectExpression(options)) return;
  const contextSize = numericLiteral(objectProperty(options, "contextSize"));
  const batchSize = numericLiteral(objectProperty(options, "batchSize"));
  const sequences = numericLiteral(objectProperty(options, "sequences"));
  if (contextSize !== undefined) context.contextSize = contextSize;
  if (batchSize !== undefined) context.batchSize = batchSize;
  if (sequences !== undefined) context.sequences = sequences;

  if (contextSize !== undefined && contextSize <= 0) {
    emitOnce(state, adapter, `invalid-context-size:${file}:${declaration.start}`, {
      rule: "node-llama-invalid-context-size",
      severity: "error",
      confidence: "high",
      file,
      ...(locationOf(options) && { location: locationOf(options) }),
      message: `node-llama-cpp context '${context.name}' uses contextSize ${contextSize}; contextSize must be positive.`,
      evidence: { context: context.name, contextSize },
    });
  }
  if (batchSize !== undefined && batchSize <= 0) {
    emitOnce(state, adapter, `invalid-batch-size:${file}:${declaration.start}`, {
      rule: "node-llama-invalid-batch-size",
      severity: "error",
      confidence: "high",
      file,
      ...(locationOf(options) && { location: locationOf(options) }),
      message: `node-llama-cpp context '${context.name}' uses batchSize ${batchSize}; batchSize must be positive.`,
      evidence: { context: context.name, batchSize },
    });
  }
  if (contextSize !== undefined && batchSize !== undefined && batchSize > contextSize) {
    emitOnce(state, adapter, `batch-exceeds-context:${file}:${declaration.start}`, {
      rule: "node-llama-batch-exceeds-context",
      severity: "warning",
      confidence: "high",
      file,
      ...(locationOf(options) && { location: locationOf(options) }),
      message: `node-llama-cpp context '${context.name}' sets batchSize (${batchSize}) above contextSize (${contextSize}); align the values or verify the intended memory budget.`,
      evidence: { context: context.name, contextSize, batchSize },
    });
  }
  if (sequences !== undefined && (!Number.isInteger(sequences) || sequences < 1)) {
    emitOnce(state, adapter, `invalid-sequences:${file}:${declaration.start}`, {
      rule: "node-llama-invalid-sequences",
      severity: "error",
      confidence: "high",
      file,
      ...(locationOf(options) && { location: locationOf(options) }),
      message: `node-llama-cpp context '${context.name}' uses sequences ${sequences}; sequences must be a positive integer.`,
      evidence: { context: context.name, sequences },
    });
  }
  if (objectProperty(options, "ignoreMemorySafetyChecks")?.value === true) {
    emitOnce(state, adapter, `memory-safety-disabled:${file}:${declaration.start}`, {
      rule: "node-llama-memory-safety-disabled",
      severity: "warning",
      confidence: "high",
      file,
      ...(locationOf(options) && { location: locationOf(options) }),
      message: `node-llama-cpp context '${context.name}' disables memory safety checks; this can crash the process when VRAM is insufficient.`,
      evidence: { context: context.name, option: "ignoreMemorySafetyChecks" },
    });
  }
}

function registerVariable(
  node: any,
  file: string,
  ancestors: any[],
  state: FileState,
  adapter: PluginAdapter,
): void {
  if (node?.type !== "VariableDeclarator") return;
  const scope = functionScope(ancestors);
  const init = unwrapAwait(node.init);
  if (!init) return;

  if (
    node.id?.type === "ObjectPattern" &&
    t.isCallExpression(init) &&
    t.isIdentifier(init.callee) &&
    init.callee.name === "require" &&
    nodeName(init.arguments?.[0]) === PACKAGE_NAME
  ) {
    for (const property of node.id.properties ?? []) {
      const imported = nodeName(property.key);
      const local = nodeName(property.value) ?? imported;
      if (!imported || !local) continue;
      if (imported === "getLlama") state.importedGetLlamaNames.add(local);
      if (imported === "LlamaChatSession") state.importedSessionNames.add(local);
    }
    return;
  }

  if (!t.isIdentifier(node.id)) return;
  const name = node.id.name;
  const call = memberCall(init);
  if (call && t.isIdentifier(call.object)) {
    const objectOrigin = getOrigin(state, call.object.name, scope);
    if (call.method === "getSequence" && objectOrigin?.kind === "context") {
      const context = state.contexts.get(objectOrigin.key);
      if (context) context.sequenceCount += 1;
      setOrigin(state, {
        key: originKey(scope, name),
        kind: "sequence",
        name,
        file,
        scope,
        contextKey: objectOrigin.key,
      });
      return;
    }
    if (call.method === "loadModel" && objectOrigin?.kind === "llama") {
      setOrigin(state, { key: originKey(scope, name), kind: "model", name, file, scope });
      return;
    }
    if (call.method === "createContext" && objectOrigin?.kind === "model") {
      const context: ContextResource = {
        key: originKey(scope, name),
        kind: "context",
        name,
        file,
        scope,
        sequences: 1,
        sequenceCount: 0,
        disposed: false,
        disposedInFinally: false,
        usingManaged: isUsingDeclaration(ancestors),
      };
      setOrigin(state, context);
      state.contexts.set(context.key, context);
      auditContextOptions(file, node, call.call.arguments?.[0], context, state, adapter);
      return;
    }
  }

  if (
    t.isCallExpression(init) &&
    t.isIdentifier(init.callee) &&
    state.importedGetLlamaNames.has(init.callee.name)
  ) {
    setOrigin(state, { key: originKey(scope, name), kind: "llama", name, file, scope });
    return;
  }

  if (
    t.isNewExpression(init) &&
    t.isIdentifier(init.callee) &&
    state.importedSessionNames.has(init.callee.name)
  ) {
    const sequence = resolveOrigin(
      state,
      objectProperty(init.arguments?.[0], "contextSequence"),
      scope,
    );
    const session: SessionResource = {
      key: originKey(scope, name),
      kind: "session",
      name,
      file,
      scope,
      ...(sequence?.contextKey && { contextKey: sequence.contextKey }),
      ...(sequence?.name && { sequenceName: sequence.name }),
    };
    setOrigin(state, session);
    state.sessions.set(session.key, session);
    return;
  }

  const origin = resolveOrigin(state, init, scope);
  if (origin) setOrigin(state, { ...origin, key: originKey(scope, name), name, scope });
}

function trackDisposal(node: any, file: string, ancestors: any[], state: FileState): void {
  const call = memberCall(node);
  if (!call || call.method !== "dispose" || !t.isIdentifier(call.object)) return;
  const scope = functionScope(ancestors);
  const origin = getOrigin(state, call.object.name, scope);
  if (origin?.kind !== "context") return;
  const context = state.contexts.get(origin.key);
  if (!context) return;
  context.disposed = true;
  context.disposedInFinally ||= isInsideFinally(node, ancestors);
}

function reportSharedSequence(
  node: any,
  file: string,
  ancestors: any[],
  state: FileState,
  adapter: PluginAdapter,
): void {
  const call = memberCall(node);
  if (
    !call ||
    !["prompt", "preloadPrompt", "completePrompt"].includes(call.method) ||
    !t.isIdentifier(call.object)
  )
    return;
  const handlerScope = functionScope(ancestors);
  const sessionOrigin = getOrigin(state, call.object.name, handlerScope);
  const session =
    sessionOrigin?.kind === "session" ? state.sessions.get(sessionOrigin.key) : undefined;
  if (!session || !isRequestScopedHandler(ancestors)) return;

  const context = session.contextKey ? state.contexts.get(session.contextKey) : undefined;
  const hasRequestScopedSequence = session.scope === handlerScope && !!session.sequenceName;
  if (hasRequestScopedSequence) return;

  emitOnce(state, adapter, `shared-sequence:${file}:${node.start}`, {
    rule: "node-llama-shared-sequence",
    severity: "warning",
    confidence: "high",
    file,
    ...(locationOf(node) && { location: locationOf(node) }),
    message: `node-llama-cpp session '${session.name}' is used in a request handler but its context sequence is shared outside that handler. Allocate a per-request sequence with context.getSequence().`,
    evidence: {
      session: session.name,
      context: context?.name,
      configuredSequences: context?.sequences ?? 1,
      sessionScope: session.scope,
      handlerScope,
    },
  });
}

function auditContextLifecycle(file: string, state: FileState, adapter: PluginAdapter): void {
  for (const context of state.contexts.values()) {
    if (!context.disposed && !context.usingManaged) {
      emitOnce(state, adapter, `missing-disposal:${file}:${context.name}:${context.scope}`, {
        rule: "node-llama-missing-disposal",
        severity: "warning",
        confidence: "high",
        file,
        message: `node-llama-cpp context '${context.name}' is created in ${context.scope} but is never disposed. Use await ${context.name}.dispose() in a finally block or explicit resource management.`,
        evidence: { context: context.name, scope: context.scope },
      });
    } else if (context.disposed && !context.disposedInFinally && !context.usingManaged) {
      emitOnce(state, adapter, `disposal-not-finally:${file}:${context.name}:${context.scope}`, {
        rule: "node-llama-disposal-not-finally",
        severity: "warning",
        confidence: "medium",
        file,
        message: `node-llama-cpp context '${context.name}' is disposed, but not in a finally block. Exceptions can bypass cleanup.`,
        evidence: { context: context.name, scope: context.scope },
      });
    }
    if (context.sequences > 0 && context.sequenceCount > context.sequences) {
      emitOnce(state, adapter, `sequence-capacity:${file}:${context.name}`, {
        rule: "node-llama-sequence-capacity",
        severity: "warning",
        confidence: "medium",
        file,
        message: `node-llama-cpp context '${context.name}' obtains ${context.sequenceCount} sequences but is configured for ${context.sequences}. Increase sequences or release/reuse sequences deliberately.`,
        evidence: {
          context: context.name,
          sequenceCount: context.sequenceCount,
          configuredSequences: context.sequences,
        },
      });
    }
  }
}

export const NodeLlamaCppPlugin: AnalyzerPlugin = {
  name: "node-llama-cpp-plugin",
  version: "1.0.0",
  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (
      pkg?.dependencies?.[PACKAGE_NAME] ||
      pkg?.devDependencies?.[PACKAGE_NAME] ||
      pkg?.peerDependencies?.[PACKAGE_NAME]
    ) {
      return true;
    }
    const sourceFiles = await adapter.findFilesByGlob([
      "**/*.ts",
      "**/*.tsx",
      "**/*.js",
      "**/*.jsx",
      "**/*.mts",
      "**/*.cts",
      "**/*.mjs",
      "**/*.cjs",
    ]);
    for (const sourceFile of sourceFiles) {
      const source = await adapter.readFile(sourceFile);
      if (source?.includes(PACKAGE_NAME)) return true;
    }
    return false;
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      stateByFile.clear();
      reportedMissingDependency = false;
      const pkg = await adapter.readJson("package.json");
      packageDeclared = !!(
        pkg?.dependencies?.[PACKAGE_NAME] ||
        pkg?.devDependencies?.[PACKAGE_NAME] ||
        pkg?.peerDependencies?.[PACKAGE_NAME]
      );
      if (pkg?.scripts) {
        for (const [scriptName, script] of Object.entries(pkg.scripts)) {
          if (typeof script === "string" && script.includes(PACKAGE_NAME)) {
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            adapter.markPackageAsUsed(PACKAGE_NAME);
          }
        }
      }
    },
    onASTNode: (node: any, file, adapter, ancestors = []) => {
      const state = stateFor(file);
      registerImport(node, file, state, adapter);
      registerVariable(node, file, ancestors, state, adapter);
      trackDisposal(node, file, ancestors, state);
      reportSharedSequence(node, file, ancestors, state, adapter);
    },
    onAnalysisComplete: (adapter) => {
      for (const [file, state] of stateByFile) auditContextLifecycle(file, state, adapter);
    },
  },
};

export default NodeLlamaCppPlugin;
