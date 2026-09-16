import type { AnalyzerPlugin, PluginAdapter } from "../types.js";
import { t } from "../ast-utils.js";
import {
  emitOnce,
  getMemberCall,
  hasDeclaredPackage,
  hasObjectProperty,
  hasRequestHandlerAncestor,
  isPackageImport,
  isPackageRequire,
  markPackageImport,
  nodeName,
  objectProperty,
  unwrapExpression,
} from "./ai-plugin-utils.js";

const PACKAGES = ["ai", "@ai-sdk/ai"] as const;
const PACKAGE_SET = new Set<string>(PACKAGES);
const TOOL_CALLS = new Set(["generateText", "streamText", "generateObject", "streamObject"]);
const BOUNDS = ["maxSteps", "stopWhen", "maxToolRoundtrips"];

interface FileState {
  callNames: Map<string, string>;
  agentNames: Set<string>;
  namespaceNames: Set<string>;
  emitted: Set<string>;
}

const files = new Map<string, FileState>();

function stateFor(file: string): FileState {
  let state = files.get(file);
  if (!state) {
    state = {
      callNames: new Map([
        ["generateText", "generateText"],
        ["streamText", "streamText"],
        ["generateObject", "generateObject"],
        ["streamObject", "streamObject"],
      ]),
      agentNames: new Set(["ToolLoopAgent"]),
      namespaceNames: new Set(["ai"]),
      emitted: new Set(),
    };
    files.set(file, state);
  }
  return state;
}

function recordImport(node: any, state: FileState, adapter: PluginAdapter): void {
  markPackageImport(node, PACKAGE_SET, adapter);
  if (!isPackageImport(node, PACKAGE_SET)) return;
  for (const specifier of node.specifiers ?? []) {
    const imported = nodeName(specifier.imported) ?? nodeName(specifier.local);
    const local = nodeName(specifier.local) ?? imported;
    if (!local) continue;
    if (imported && TOOL_CALLS.has(imported)) state.callNames.set(local, imported);
    if (imported === "ToolLoopAgent") state.agentNames.add(local);
    if (["ImportNamespaceSpecifier", "ImportDefaultSpecifier"].includes(specifier.type))
      state.namespaceNames.add(local);
  }
}

function callKind(node: any, state: FileState): string | undefined {
  if (!t.isCallExpression(node)) return undefined;
  if (t.isIdentifier(node.callee)) return state.callNames.get(node.callee.name);
  const member = getMemberCall(node);
  return member &&
    t.isIdentifier(member.object) &&
    state.namespaceNames.has(member.object.name) &&
    TOOL_CALLS.has(member.method)
    ? member.method
    : undefined;
}

function hasBound(options: any): boolean {
  return BOUNDS.some((key) => hasObjectProperty(options, key));
}

function auditOptions(
  kind: string,
  options: any,
  node: any,
  file: string,
  ancestors: any[],
  state: FileState,
  adapter: PluginAdapter,
): void {
  if (!t.isObjectExpression(options)) return;
  const hasTools = hasObjectProperty(options, "tools");
  if (hasTools && !hasBound(options)) {
    emitOnce(state.emitted, adapter, `unbounded-tools:${file}:${node.start}`, {
      rule: "ai-sdk-unbounded-tool-loop",
      severity: "warning",
      confidence: "high",
      file,
      message: `${kind}() enables AI SDK tools without a static maxSteps/stopWhen bound. Add a finite stopWhen or maxSteps limit to control tool cost and loop duration.`,
      evidence: { api: kind, availableBounds: BOUNDS },
    });
  }
  if (
    kind === "streamText" &&
    hasRequestHandlerAncestor(ancestors) &&
    !hasObjectProperty(options, "onError")
  ) {
    emitOnce(state.emitted, adapter, `stream-no-error-handler:${file}:${node.start}`, {
      rule: "ai-sdk-stream-no-error-handler",
      severity: "warning",
      confidence: "medium",
      file,
      message:
        "streamText() is returned from a request handler without an onError callback. Provide stream error handling so failures are surfaced safely to the caller and logs.",
      evidence: { api: kind, recommendation: "onError" },
    });
  }
}

function auditAgent(node: any, file: string, state: FileState, adapter: PluginAdapter): void {
  const expression = unwrapExpression(node);
  if (
    !t.isNewExpression(expression) ||
    !t.isIdentifier(expression.callee) ||
    !state.agentNames.has(expression.callee.name)
  )
    return;
  const options = expression.arguments?.[0];
  if (!t.isObjectExpression(options) || !hasObjectProperty(options, "tools") || hasBound(options))
    return;
  emitOnce(state.emitted, adapter, `unbounded-agent:${file}:${node.start}`, {
    rule: "ai-sdk-unbounded-tool-loop",
    severity: "warning",
    confidence: "high",
    file,
    message:
      "ToolLoopAgent is configured with tools but without a static maxSteps/stopWhen bound. Add an explicit finite loop limit.",
    evidence: { api: "ToolLoopAgent", availableBounds: BOUNDS },
  });
}

export const VercelAiSdkPlugin: AnalyzerPlugin = {
  name: "vercel-ai-sdk-plugin",
  version: "1.0.0",
  detect: (adapter) => hasDeclaredPackage(adapter, PACKAGES),
  lifecycle: {
    onProjectInit: () => files.clear(),
    onASTNode: (node: any, file, adapter, ancestors = []) => {
      const state = stateFor(file);
      recordImport(node, state, adapter);
      if (isPackageRequire(node, PACKAGE_SET))
        adapter.markPackageAsUsed(nodeName(node.arguments?.[0])!);
      const kind = callKind(node, state);
      if (kind) auditOptions(kind, node.arguments?.[0], node, file, ancestors, state, adapter);
      auditAgent(node, file, state, adapter);
    },
  },
};

export default VercelAiSdkPlugin;
