import type { AnalyzerPlugin, Finding, PluginAdapter } from "../types.js";
import { t } from "../ast-utils.js";

export function nodeName(node: any): string | undefined {
  if (t.isIdentifier(node)) return node.name;
  if (t.isStringLiteral(node) || t.isLiteral(node)) return typeof node.value === "string" ? node.value : undefined;
  return undefined;
}

export function unwrapExpression(node: any): any {
  let current = node;
  while (current && ["AwaitExpression", "TSAsExpression", "TSTypeAssertion", "TSNonNullExpression", "ChainExpression"].includes(current.type)) {
    current = current.argument ?? current.expression;
  }
  return current;
}

export function memberName(node: any): string | undefined {
  if (!node || (node.type !== "MemberExpression" && node.type !== "OptionalMemberExpression")) return undefined;
  return nodeName(node.property);
}

export function getMemberCall(node: any): { call: any; object: any; method: string } | undefined {
  const call = unwrapExpression(node);
  if (!t.isCallExpression(call) && call?.type !== "OptionalCallExpression") return undefined;
  const method = memberName(call.callee);
  return method ? { call, object: call.callee.object, method } : undefined;
}

export function objectProperty(object: any, key: string): any | undefined {
  if (!t.isObjectExpression(object)) return undefined;
  return object.properties?.find((property: any) =>
    property && (property.type === "Property" || property.type === "ObjectProperty") && nodeName(property.key) === key,
  )?.value;
}

export function hasObjectProperty(object: any, key: string): boolean {
  return objectProperty(object, key) !== undefined;
}

export function isLiteralTrue(node: any): boolean {
  return unwrapExpression(node)?.value === true;
}

export function functionScope(ancestors: any[]): string {
  const fn = [...ancestors].reverse().find((node) =>
    node && ["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression", "ObjectMethod", "ClassMethod"].includes(node.type),
  );
  if (!fn) return "module";
  return `function:${fn.id?.name ?? fn.key?.name ?? "anonymous"}@${fn.start ?? "unknown"}`;
}

export function hasAncestorLoop(ancestors: any[]): boolean {
  return ancestors.some((node) => node && ["ForStatement", "ForInStatement", "ForOfStatement", "WhileStatement", "DoWhileStatement"].includes(node.type));
}

export function hasRequestHandlerAncestor(ancestors: any[]): boolean {
  const fn = [...ancestors].reverse().find((node) =>
    node && ["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"].includes(node.type),
  );
  if (fn?.params?.some((parameter: any) => ["req", "res", "request", "response", "reply", "ctx", "event"].includes(nodeName(parameter) ?? ""))) {
    return true;
  }
  return ancestors.some((node) => {
    const member = getMemberCall(node);
    return !!member && ["get", "post", "put", "patch", "delete", "all", "use", "route", "handle", "on"].includes(member.method);
  });
}

export function rangeContains(container: any, node: any): boolean {
  return typeof container?.start === "number" && typeof container?.end === "number" &&
    typeof node?.start === "number" && typeof node?.end === "number" &&
    container.start <= node.start && container.end >= node.end;
}

export function isWithinTidy(node: any, ancestors: any[], tfNames: Set<string>): boolean {
  return ancestors.some((ancestor) => {
    const member = getMemberCall(ancestor);
    return !!member && member.method === "tidy" && t.isIdentifier(member.object) && tfNames.has(member.object.name) && rangeContains(ancestor, node);
  });
}

export function importLocals(node: any, packageNames: Set<string>, importedName: string): string[] {
  if (!t.isImportDeclaration(node) || !packageNames.has(node.source?.value)) return [];
  return (node.specifiers ?? []).flatMap((specifier: any) => {
    const imported = nodeName(specifier.imported) ?? nodeName(specifier.local);
    const local = nodeName(specifier.local) ?? imported;
    return imported === importedName && local ? [local] : [];
  });
}

export function isPackageImport(node: any, packageNames: Set<string>): boolean {
  return t.isImportDeclaration(node) && packageNames.has(node.source?.value);
}

export function isPackageRequire(node: any, packageNames: Set<string>): boolean {
  return t.isCallExpression(node) && t.isIdentifier(node.callee) && node.callee.name === "require" && packageNames.has(nodeName(node.arguments?.[0]) ?? "");
}

export async function hasDeclaredPackage(adapter: PluginAdapter, packageNames: readonly string[]): Promise<boolean> {
  const pkg = await adapter.readJson("package.json");
  return packageNames.some((name) => !!(pkg?.dependencies?.[name] || pkg?.devDependencies?.[name] || pkg?.peerDependencies?.[name]));
}

export function markPackageImport(node: any, packageNames: Set<string>, adapter: PluginAdapter): void {
  if (isPackageImport(node, packageNames)) adapter.markPackageAsUsed(node.source.value);
  if (isPackageRequire(node, packageNames)) adapter.markPackageAsUsed(nodeName(node.arguments?.[0])!);
}

export function emitOnce(
  emitted: Set<string>,
  adapter: PluginAdapter,
  key: string,
  finding: Omit<Finding, "rule"> & { rule?: string },
): void {
  if (emitted.has(key)) return;
  emitted.add(key);
  adapter.emitFinding(finding);
}

export type PluginDefinition = Pick<AnalyzerPlugin, "name" | "version" | "lifecycle" | "detect">;
