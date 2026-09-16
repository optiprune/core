import type { AnalyzerPlugin, PluginAdapter } from "../types.js";
import { t } from "../ast-utils.js";
import {
  emitOnce,
  functionScope,
  getMemberCall,
  hasDeclaredPackage,
  hasObjectProperty,
  isPackageImport,
  isPackageRequire,
  markPackageImport,
  nodeName,
  objectProperty,
  unwrapExpression,
} from "./ai-plugin-utils.js";

const PACKAGES = ["langchain", "@langchain/core", "@langchain/langgraph"] as const;
const PACKAGE_SET = new Set<string>(PACKAGES);
const PROMPT_CLASSES = new Set(["ChatPromptTemplate", "PromptTemplate"]);
const USER_CONTROLLED_NAMES = /(?:input|user|query|prompt|message|request|body|text)/i;

interface GraphResource {
  key: string;
  name: string;
  file: string;
  scope: string;
}

interface FileState {
  promptClasses: Set<string>;
  stateGraphClasses: Set<string>;
  graphBuilders: Set<string>;
  compiledGraphs: Map<string, GraphResource>;
  emitted: Set<string>;
}

const files = new Map<string, FileState>();

function stateFor(file: string): FileState {
  let state = files.get(file);
  if (!state) {
    state = {
      promptClasses: new Set(PROMPT_CLASSES),
      stateGraphClasses: new Set(["StateGraph"]),
      graphBuilders: new Set(),
      compiledGraphs: new Map(),
      emitted: new Set(),
    };
    files.set(file, state);
  }
  return state;
}

function keyFor(scope: string, name: string): string {
  return `${scope}::${name}`;
}

function graphFor(state: FileState, name: string, scope: string): GraphResource | undefined {
  return (
    state.compiledGraphs.get(keyFor(scope, name)) ??
    state.compiledGraphs.get(keyFor("module", name))
  );
}

function recordImport(node: any, state: FileState, adapter: PluginAdapter): void {
  markPackageImport(node, PACKAGE_SET, adapter);
  if (!isPackageImport(node, PACKAGE_SET)) return;
  for (const specifier of node.specifiers ?? []) {
    const imported = nodeName(specifier.imported) ?? nodeName(specifier.local);
    const local = nodeName(specifier.local) ?? imported;
    if (!imported || !local) continue;
    if (PROMPT_CLASSES.has(imported)) state.promptClasses.add(local);
    if (imported === "StateGraph") state.stateGraphClasses.add(local);
  }
}

function isPromptTemplateCall(node: any, state: FileState): boolean {
  const call = getMemberCall(node);
  return (
    !!call &&
    call.method === "fromTemplate" &&
    t.isIdentifier(call.object) &&
    state.promptClasses.has(call.object.name)
  );
}

function containsUserControlledValue(node: any): boolean {
  if (!node) return false;
  if (t.isIdentifier(node)) return USER_CONTROLLED_NAMES.test(node.name);
  if (node.type === "MemberExpression" || node.type === "OptionalMemberExpression")
    return containsUserControlledValue(node.object) || containsUserControlledValue(node.property);
  if (node.type === "TemplateLiteral")
    return (node.expressions ?? []).some(containsUserControlledValue);
  if (node.type === "BinaryExpression")
    return containsUserControlledValue(node.left) || containsUserControlledValue(node.right);
  return false;
}

function isPromptConstructionAncestor(ancestors: any[], state: FileState): boolean {
  return ancestors.some((ancestor) => {
    if (isPromptTemplateCall(ancestor, state)) return true;
    const expression = unwrapExpression(ancestor);
    return (
      t.isNewExpression(expression) &&
      t.isIdentifier(expression.callee) &&
      state.promptClasses.has(expression.callee.name)
    );
  });
}

function auditPrompt(
  node: any,
  file: string,
  ancestors: any[],
  state: FileState,
  adapter: PluginAdapter,
): void {
  const isTemplateLiteral = node?.type === "TemplateLiteral" && (node.expressions?.length ?? 0) > 0;
  const isConcatenation = node?.type === "BinaryExpression" && node.operator === "+";
  if (
    (!isTemplateLiteral && !isConcatenation) ||
    !containsUserControlledValue(node) ||
    !isPromptConstructionAncestor(ancestors, state)
  )
    return;
  emitOnce(state.emitted, adapter, `prompt-injection:${file}:${node.start}`, {
    rule: "langchain-direct-prompt-interpolation",
    severity: "warning",
    confidence: "medium",
    file,
    message:
      "LangChain prompt template directly interpolates a value with a user-controlled-looking name. Prefer structured message variables and validate or delimit untrusted content to reduce prompt-injection risk.",
    evidence: {
      pattern: isTemplateLiteral ? "template-literal" : "string-concatenation",
      recommendation: "structured prompt variables",
    },
  });
}

function recordGraph(node: any, file: string, ancestors: any[], state: FileState): void {
  if (node?.type !== "VariableDeclarator" || !t.isIdentifier(node.id)) return;
  const scope = functionScope(ancestors);
  const init = unwrapExpression(node.init);
  if (
    t.isNewExpression(init) &&
    t.isIdentifier(init.callee) &&
    state.stateGraphClasses.has(init.callee.name)
  ) {
    state.graphBuilders.add(keyFor(scope, node.id.name));
    return;
  }
  const compile = getMemberCall(init);
  if (compile?.method === "compile" && t.isIdentifier(compile.object)) {
    const builderKey = keyFor(scope, compile.object.name);
    if (
      !state.graphBuilders.has(builderKey) &&
      !state.graphBuilders.has(keyFor("module", compile.object.name))
    )
      return;
    const graph: GraphResource = {
      key: keyFor(scope, node.id.name),
      name: node.id.name,
      file,
      scope,
    };
    state.compiledGraphs.set(graph.key, graph);
  }
}

function auditGraphInvocation(
  node: any,
  file: string,
  ancestors: any[],
  state: FileState,
  adapter: PluginAdapter,
): void {
  if (!t.isCallExpression(node)) return;
  const call = getMemberCall(node);
  if (!call || !["invoke", "stream", "batch"].includes(call.method) || !t.isIdentifier(call.object))
    return;
  const graph = graphFor(state, call.object.name, functionScope(ancestors));
  if (!graph) return;
  const config = call.call.arguments?.[1];
  if (t.isObjectExpression(config) && hasObjectProperty(config, "recursionLimit")) return;
  emitOnce(state.emitted, adapter, `missing-recursion-limit:${file}:${(node as any).start}`, {
    rule: "langgraph-missing-recursion-limit",
    severity: "warning",
    confidence: "high",
    file,
    message: `LangGraph '${graph.name}.${call.method}()' is invoked without a static recursionLimit. Supply a finite limit in the invocation config to bound cyclic graph execution.`,
    evidence: { graph: graph.name, method: call.method, expectedConfig: "recursionLimit" },
  });
}

export const LangChainJsPlugin: AnalyzerPlugin = {
  name: "langchainjs-plugin",
  version: "1.0.0",
  detect: (adapter) => hasDeclaredPackage(adapter, PACKAGES),
  lifecycle: {
    onProjectInit: () => files.clear(),
    onASTNode: (node: any, file, adapter, ancestors = []) => {
      const state = stateFor(file);
      recordImport(node, state, adapter);
      if (isPackageRequire(node, PACKAGE_SET))
        adapter.markPackageAsUsed(nodeName(node.arguments?.[0])!);
      auditPrompt(node, file, ancestors, state, adapter);
      recordGraph(node, file, ancestors, state);
      auditGraphInvocation(node, file, ancestors, state, adapter);
    },
  },
};

export default LangChainJsPlugin;
