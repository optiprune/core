import type { AnalyzerPlugin, PluginAdapter } from "../types.js";
import { t } from "../ast-utils.js";
import {
  emitOnce,
  functionScope,
  getMemberCall,
  hasDeclaredPackage,
  isPackageImport,
  isPackageRequire,
  markPackageImport,
  nodeName,
  rangeContains,
  unwrapExpression,
} from "./ai-plugin-utils.js";

const PACKAGE = "onnxruntime-node";
const PACKAGES = [PACKAGE] as const;
const PACKAGE_SET = new Set<string>(PACKAGES);

type ResourceKind = "session" | "tensor";

interface Resource {
  key: string;
  kind: ResourceKind;
  name: string;
  file: string;
  scope: string;
  released: boolean;
  releasedInFinally: boolean;
}

interface FileState {
  namespaceNames: Set<string>;
  sessionFactoryNames: Set<string>;
  tensorNames: Set<string>;
  resources: Map<string, Resource>;
  emitted: Set<string>;
}

const files = new Map<string, FileState>();

function stateFor(file: string): FileState {
  let state = files.get(file);
  if (!state) {
    state = {
      namespaceNames: new Set(["ort"]),
      sessionFactoryNames: new Set(["InferenceSession"]),
      tensorNames: new Set(["Tensor"]),
      resources: new Map(),
      emitted: new Set(),
    };
    files.set(file, state);
  }
  return state;
}

function keyFor(scope: string, name: string): string {
  return `${scope}::${name}`;
}

function getResource(state: FileState, name: string, scope: string): Resource | undefined {
  return state.resources.get(keyFor(scope, name)) ?? state.resources.get(keyFor("module", name));
}

function inFinally(node: any, ancestors: any[]): boolean {
  return ancestors.some((ancestor) => ancestor?.type === "TryStatement" && rangeContains(ancestor.finalizer, node));
}

function recordImport(node: any, state: FileState, adapter: PluginAdapter): void {
  markPackageImport(node, PACKAGE_SET, adapter);
  if (!isPackageImport(node, PACKAGE_SET)) return;
  for (const specifier of node.specifiers ?? []) {
    if (["ImportNamespaceSpecifier", "ImportDefaultSpecifier"].includes(specifier.type) && t.isIdentifier(specifier.local)) state.namespaceNames.add(specifier.local.name);
    const imported = nodeName(specifier.imported) ?? nodeName(specifier.local);
    const local = nodeName(specifier.local) ?? imported;
    if (imported === "InferenceSession" && local) state.sessionFactoryNames.add(local);
    if (imported === "Tensor" && local) state.tensorNames.add(local);
  }
}

function isSessionCreation(node: any, state: FileState): boolean {
  const call = getMemberCall(node);
  return !!call && call.method === "create" && (
    (t.isIdentifier(call.object) && state.sessionFactoryNames.has(call.object.name)) ||
    (call.object?.type === "MemberExpression" && t.isIdentifier(call.object.object) && state.namespaceNames.has(call.object.object.name) && nodeName(call.object.property) === "InferenceSession")
  );
}

function isTensorCreation(node: any, state: FileState): boolean {
  const expression = unwrapExpression(node);
  if (!t.isNewExpression(expression)) return false;
  if (t.isIdentifier(expression.callee)) return state.tensorNames.has(expression.callee.name);
  return expression.callee?.type === "MemberExpression" && t.isIdentifier(expression.callee.object) && state.namespaceNames.has(expression.callee.object.name) && nodeName(expression.callee.property) === "Tensor";
}

function recordResource(node: any, file: string, ancestors: any[], state: FileState): void {
  if (node?.type !== "VariableDeclarator" || !t.isIdentifier(node.id)) return;
  const kind: ResourceKind | undefined = isSessionCreation(node.init, state) ? "session" : isTensorCreation(node.init, state) ? "tensor" : undefined;
  if (!kind) return;
  const scope = functionScope(ancestors);
  const resource: Resource = { key: keyFor(scope, node.id.name), kind, name: node.id.name, file, scope, released: false, releasedInFinally: false };
  state.resources.set(resource.key, resource);
}

function recordRelease(node: any, ancestors: any[], state: FileState): void {
  const call = getMemberCall(node);
  if (!call || !["release", "dispose"].includes(call.method) || !t.isIdentifier(call.object)) return;
  const resource = getResource(state, call.object.name, functionScope(ancestors));
  if (!resource) return;
  resource.released = true;
  resource.releasedInFinally ||= inFinally(node, ancestors);
}

function audit(adapter: PluginAdapter): void {
  for (const state of files.values()) {
    for (const resource of state.resources.values()) {
      if (!resource.released) {
        emitOnce(state.emitted, adapter, `unreleased:${resource.file}:${resource.key}`, {
          rule: resource.kind === "session" ? "onnx-unreleased-session" : "onnx-unreleased-tensor",
          severity: "warning",
          confidence: "high",
          file: resource.file,
          message: `onnxruntime-node ${resource.kind} '${resource.name}' is not released. Release native resources explicitly when the owning scope finishes.`,
          evidence: { resource: resource.name, resourceKind: resource.kind, scope: resource.scope, expectedRelease: `${resource.name}.release()` },
        });
      } else if (resource.kind === "session" && !resource.releasedInFinally) {
        emitOnce(state.emitted, adapter, `release-not-finally:${resource.file}:${resource.key}`, {
          rule: "onnx-session-release-not-finally",
          severity: "warning",
          confidence: "medium",
          file: resource.file,
          message: `onnxruntime-node session '${resource.name}' is released outside a finally block; an exception can leave the native session locked.`,
          evidence: { session: resource.name, scope: resource.scope },
        });
      }
    }
  }
}

export const OnnxruntimeNodePlugin: AnalyzerPlugin = {
  name: "onnxruntime-node-plugin",
  version: "1.0.0",
  detect: (adapter) => hasDeclaredPackage(adapter, PACKAGES),
  lifecycle: {
    onProjectInit: () => files.clear(),
    onASTNode: (node: any, file, adapter, ancestors = []) => {
      const state = stateFor(file);
      recordImport(node, state, adapter);
      if (isPackageRequire(node, PACKAGE_SET)) adapter.markPackageAsUsed(PACKAGE);
      recordResource(node, file, ancestors, state);
      recordRelease(node, ancestors, state);
    },
    onAnalysisComplete: audit,
  },
};

export default OnnxruntimeNodePlugin;
