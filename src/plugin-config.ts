import { parseModule, walkAst } from "./parser.js";
import type { PluginAdapter } from "./types.js";

export type StaticConfigValue = string | number | boolean | null | StaticConfigValue[] | { [key: string]: StaticConfigValue };

export interface LoadedPluginConfig {
  config: Record<string, StaticConfigValue>;
  source: string;
}

function stripJsonComments(source: string): string {
  return source
    .replace(/("(?:[^"\\]|\\.)*")|\/\/[^\n]*/g, (_match, quoted) => quoted ?? "")
    .replace(/("(?:[^"\\]|\\.)*")|\/\*[\s\S]*?\*\//g, (_match, quoted) => quoted ?? "")
    .replace(/,(\s*[}\]])/g, "$1");
}

function propertyName(node: any): string | undefined {
  if (!node || node.computed) return undefined;
  if (node.key?.type === "Identifier") return node.key.name;
  if (typeof node.key?.value === "string") return node.key.value;
  return undefined;
}

function isIdentifier(node: any, name: string): boolean {
  return node?.type === "Identifier" && node.name === name;
}

function unwrapStaticExpression(node: any): any {
  if (!node) return undefined;

  if (
    node.type === "TSAsExpression" ||
    node.type === "TSSatisfiesExpression" ||
    node.type === "TSTypeAssertion" ||
    node.type === "TSNonNullExpression" ||
    node.type === "TypeCastExpression"
  ) {
    return unwrapStaticExpression(node.expression);
  }

  if (
    node.type === "CallExpression" &&
    node.arguments?.length === 1 &&
    (isIdentifier(node.callee, "defineConfig") ||
      (node.callee?.type === "MemberExpression" &&
        !node.callee.computed &&
        isIdentifier(node.callee.property, "defineConfig")))
  ) {
    return unwrapStaticExpression(node.arguments[0]);
  }

  return node;
}

function toStaticValue(node: any): StaticConfigValue | undefined {
  node = unwrapStaticExpression(node);
  if (!node) return undefined;
  if (node.type === "Literal") {
    return node.value === null ||
      typeof node.value === "string" ||
      typeof node.value === "number" ||
      typeof node.value === "boolean"
      ? node.value
      : undefined;
  }
  if (node.type === "StringLiteral" || node.type === "NumericLiteral" || node.type === "BooleanLiteral") return node.value;
  if (node.type === "NullLiteral") return null;
  if (node.type === "TemplateLiteral" && (node.expressions?.length ?? 0) === 0) {
    return node.quasis?.map((quasi: any) => quasi.value?.cooked ?? quasi.value?.raw ?? "").join("") ?? "";
  }
  if (node.type === "ArrayExpression") {
    const values = (node.elements ?? []).map((element: any) => toStaticValue(element));
    return values.every((value: StaticConfigValue | undefined) => value !== undefined)
      ? values as StaticConfigValue[]
      : undefined;
  }
  if (node.type === "ObjectExpression") {
    const result: Record<string, StaticConfigValue> = {};
    for (const property of node.properties ?? []) {
      const name = propertyName(property);
      const value = toStaticValue(property.value);
      if (!name || value === undefined) continue;
      result[name] = value;
    }
    return result;
  }
  return undefined;
}

function parseStaticModuleConfig(source: string, file: string): Record<string, StaticConfigValue> | undefined {
  const module = parseModule(source, file);
  if (!module.ast) return undefined;

  let configExpression: any;
  walkAst(module.ast, (node: any) => {
    if (configExpression) return;
    if (node.type === "ExportDefaultDeclaration") {
      configExpression = unwrapStaticExpression(node.declaration);
      return;
    }
    if (
      node.type === "AssignmentExpression" &&
      node.left?.type === "MemberExpression" &&
      node.left.object?.type === "Identifier" &&
      node.left.object.name === "module" &&
      node.left.property?.type === "Identifier" &&
      node.left.property.name === "exports"
    ) {
      configExpression = unwrapStaticExpression(node.right);
    }
  });

  const value = toStaticValue(configExpression);
  return value && !Array.isArray(value) && typeof value === "object" ? value as Record<string, StaticConfigValue> : undefined;
}

/**
 * Reads only declarative configuration. Dynamic code is deliberately not executed;
 * a plugin can still protect the config file, but no uncertain settings are applied.
 */
export async function loadStaticPluginConfig(
  adapter: PluginAdapter,
  configFiles: string[],
  packageJsonKey?: string,
): Promise<LoadedPluginConfig | undefined> {
  for (const configFile of configFiles) {
    if (!(await adapter.folderExists(configFile))) continue;
    const source = await adapter.readFile(configFile);
    if (!source) continue;

    try {
      const config = configFile.endsWith(".json") || configFile.endsWith(".jsonc")
        ? JSON.parse(stripJsonComments(source)) as Record<string, StaticConfigValue>
        : parseStaticModuleConfig(source, configFile);
      if (config && !Array.isArray(config)) {
        adapter.markAsUsed(configFile);
        return { config, source: configFile };
      }
    } catch {
      // Ignore malformed or dynamic configurations; executing project config is unsafe.
    }
  }

  if (packageJsonKey) {
    const packageJson = await adapter.readJson("package.json");
    const config = packageJson?.[packageJsonKey];
    if (config && typeof config === "object" && !Array.isArray(config)) {
      adapter.markAsUsed("package.json", packageJsonKey);
      return { config: config as Record<string, StaticConfigValue>, source: `package.json#${packageJsonKey}` };
    }
  }

  return undefined;
}

export function stringArray(value: StaticConfigValue | undefined): string[] {
  if (typeof value === "string") return [value];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

export function stringRecord(value: StaticConfigValue | undefined): Record<string, StaticConfigValue> {
  return value && !Array.isArray(value) && typeof value === "object"
    ? value as Record<string, StaticConfigValue>
    : {};
}
