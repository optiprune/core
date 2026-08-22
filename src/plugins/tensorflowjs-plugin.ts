import type { AnalyzerPlugin, PluginAdapter } from "../types.js";
import { t } from "../ast-utils.js";
import {
  emitOnce,
  functionScope,
  getMemberCall,
  hasDeclaredPackage,
  isPackageImport,
  isPackageRequire,
  isWithinTidy,
  markPackageImport,
  nodeName,
  unwrapExpression,
} from "./ai-plugin-utils.js";

const PACKAGES = ["@tensorflow/tfjs", "@tensorflow/tfjs-node", "@tensorflow/tfjs-core"] as const;
const PACKAGE_SET = new Set<string>(PACKAGES);
const TENSOR_CREATORS = /^(tensor\d*d?|scalar|zeros(?:Like)?|ones(?:Like)?|fill|range|linspace|random(?:Normal|Uniform)?|truncatedNormal|buffer|fromPixels)$/;

interface TensorResource {
  key: string;
  name: string;
  file: string;
  scope: string;
  disposed: boolean;
}

interface FileState {
  tfNames: Set<string>;
  tensors: Map<string, TensorResource>;
  emitted: Set<string>;
}

const files = new Map<string, FileState>();

function stateFor(file: string): FileState {
  let state = files.get(file);
  if (!state) {
    state = { tfNames: new Set(["tf"]), tensors: new Map(), emitted: new Set() };
    files.set(file, state);
  }
  return state;
}

function keyFor(scope: string, name: string): string {
  return `${scope}::${name}`;
}

function tensorFor(state: FileState, name: string, scope: string): TensorResource | undefined {
  return state.tensors.get(keyFor(scope, name)) ?? state.tensors.get(keyFor("module", name));
}

function isTensorCreation(node: any, tfNames: Set<string>): boolean {
  const call = getMemberCall(node);
  if (!call || !t.isIdentifier(call.object) || !tfNames.has(call.object.name)) return false;
  return TENSOR_CREATORS.test(call.method);
}

function recordImport(node: any, state: FileState, adapter: PluginAdapter): void {
  markPackageImport(node, PACKAGE_SET, adapter);
  if (!isPackageImport(node, PACKAGE_SET)) return;
  for (const specifier of node.specifiers ?? []) {
    if (["ImportNamespaceSpecifier", "ImportDefaultSpecifier"].includes(specifier.type) && t.isIdentifier(specifier.local)) {
      state.tfNames.add(specifier.local.name);
    }
  }
}

function recordTensor(node: any, file: string, ancestors: any[], state: FileState): void {
  if (node?.type !== "VariableDeclarator" || !t.isIdentifier(node.id)) return;
  const init = unwrapExpression(node.init);
  if (!isTensorCreation(init, state.tfNames) || isWithinTidy(node, ancestors, state.tfNames)) return;
  const scope = functionScope(ancestors);
  const tensor: TensorResource = { key: keyFor(scope, node.id.name), name: node.id.name, file, scope, disposed: false };
  state.tensors.set(tensor.key, tensor);
}

function recordDisposal(node: any, ancestors: any[], state: FileState): void {
  const call = getMemberCall(node);
  const scope = functionScope(ancestors);
  if (!call || call.method !== "dispose" || !t.isIdentifier(call.object)) return;
  if (state.tfNames.has(call.object.name) && t.isIdentifier(call.call.arguments?.[0])) {
    const tensor = tensorFor(state, call.call.arguments[0].name, scope);
    if (tensor) tensor.disposed = true;
    return;
  }
  const tensor = tensorFor(state, call.object.name, scope);
  if (tensor) tensor.disposed = true;
}

function audit(adapter: PluginAdapter): void {
  for (const state of files.values()) {
    for (const tensor of state.tensors.values()) {
      if (tensor.disposed) continue;
      emitOnce(state.emitted, adapter, `tensor-leak:${tensor.file}:${tensor.key}`, {
        rule: "tfjs-undisposed-tensor",
        severity: "warning",
        confidence: "high",
        file: tensor.file,
        message: `TensorFlow.js tensor '${tensor.name}' is created outside tf.tidy() and has no matching dispose() call. Wrap temporary tensor work in tf.tidy() or explicitly dispose the tensor.`,
        evidence: { tensor: tensor.name, scope: tensor.scope, safeAlternatives: ["tf.tidy", "tensor.dispose", "tf.dispose"] },
      });
    }
  }
}

export const TensorflowJsPlugin: AnalyzerPlugin = {
  name: "tensorflowjs-plugin",
  version: "1.0.0",
  detect: (adapter) => hasDeclaredPackage(adapter, PACKAGES),
  lifecycle: {
    onProjectInit: () => files.clear(),
    onASTNode: (node: any, file, adapter, ancestors = []) => {
      const state = stateFor(file);
      recordImport(node, state, adapter);
      if (isPackageRequire(node, PACKAGE_SET)) adapter.markPackageAsUsed(nodeName(node.arguments?.[0])!);
      recordTensor(node, file, ancestors, state);
      recordDisposal(node, ancestors, state);
    },
    onAnalysisComplete: audit,
  },
};

export default TensorflowJsPlugin;
