import type { AnalyzerPlugin, PluginAdapter } from "../types.js";
import { t } from "../ast-utils.js";
import {
  emitOnce,
  getMemberCall,
  hasAncestorLoop,
  hasDeclaredPackage,
  hasRequestHandlerAncestor,
  isPackageImport,
  isPackageRequire,
  markPackageImport,
  nodeName,
  unwrapExpression,
} from "./ai-plugin-utils.js";

const PACKAGE = "@huggingface/transformers";
const PACKAGES = [PACKAGE] as const;
const PACKAGE_SET = new Set<string>(PACKAGES);

interface FileState {
  pipelineNames: Set<string>;
  namespaceNames: Set<string>;
  emitted: Set<string>;
}

const files = new Map<string, FileState>();

function stateFor(file: string): FileState {
  let state = files.get(file);
  if (!state) {
    state = {
      pipelineNames: new Set(["pipeline"]),
      namespaceNames: new Set(["transformers"]),
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
    if (imported === "pipeline" && local) state.pipelineNames.add(local);
    if (["ImportNamespaceSpecifier", "ImportDefaultSpecifier"].includes(specifier.type) && local)
      state.namespaceNames.add(local);
  }
}

function isPipelineInstantiation(node: any, state: FileState): boolean {
  if (!t.isCallExpression(node)) return false;
  if (t.isIdentifier(node.callee)) return state.pipelineNames.has(node.callee.name);
  const member = getMemberCall(node);
  return (
    !!member &&
    member.method === "pipeline" &&
    t.isIdentifier(member.object) &&
    state.namespaceNames.has(member.object.name)
  );
}

export const TransformersJsPlugin: AnalyzerPlugin = {
  name: "transformersjs-plugin",
  version: "1.0.0",
  detect: (adapter) => hasDeclaredPackage(adapter, PACKAGES),
  lifecycle: {
    onProjectInit: () => files.clear(),
    onASTNode: (node: any, file, adapter, ancestors = []) => {
      const state = stateFor(file);
      recordImport(node, state, adapter);
      if (isPackageRequire(node, PACKAGE_SET)) adapter.markPackageAsUsed(PACKAGE);
      if (!isPipelineInstantiation(node, state)) return;

      const inLoop = hasAncestorLoop(ancestors);
      const inHandler = hasRequestHandlerAncestor(ancestors);
      if (!inLoop && !inHandler) return;
      emitOnce(state.emitted, adapter, `pipeline-hot-path:${file}:${node.start}`, {
        rule: "transformers-pipeline-hot-path",
        severity: "warning",
        confidence: "high",
        file,
        message:
          "Transformers.js pipeline() is instantiated in a loop or request handler. Cache the pipeline at module or service scope to avoid repeated model loading, latency, and memory pressure.",
        evidence: {
          inLoop,
          inRequestHandler: inHandler,
          recommendation: "cache pipeline() outside the hot path",
        },
      });
    },
  },
};

export default TransformersJsPlugin;
