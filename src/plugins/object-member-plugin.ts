import { AnalyzerPlugin, PluginAdapter } from "../types.js";
import { t } from "../ast-utils.js";

interface MemberDef {
  fileId: string;
  members: Map<string, any>;
  loc: any;
}

/**
 * State store scoped per plugin instance to prevent memory leaks across test/watch runs.
 */
class MemberTrackerState {
  definitions = new Map<string, MemberDef>();
  usages = new Set<string>();
  wildcardObjects = new Set<string>();
  // Local aliases let us follow common object-flow patterns such as
  // `const routers = [expressRouter]` and `routers.map((router) => router.name)`.
  // The previous implementation only matched the original exported identifier,
  // which caused false positives for interface-driven consumers.
  aliases = new Map<string, Set<string>>();

  reset() {
    this.definitions.clear();
    this.usages.clear();
    this.wildcardObjects.clear();
    this.aliases.clear();
  }

  addAlias(alias: string, target: string) {
    if (!this.aliases.has(alias)) this.aliases.set(alias, new Set());
    this.aliases.get(alias)!.add(target);
  }

  resolveAliases(name: string): Set<string> {
    const resolved = new Set<string>([name]);
    const queue = [name];
    while (queue.length) {
      const current = queue.shift()!;
      for (const target of this.aliases.get(current) ?? []) {
        if (!resolved.has(target)) {
          resolved.add(target);
          queue.push(target);
        }
      }
    }
    return resolved;
  }
}

const state = new MemberTrackerState();
const STORYBOOK_FILE_REGEX = /\.(?:stories|story)\.[cm]?[jt]sx?$/i;

function isStorybookStory(fileId: string): boolean {
  return STORYBOOK_FILE_REGEX.test(fileId.replace(/\\/g, "/"));
}

function isExternalConfigContract(fileId: string, objectName: string): boolean {
  const normalized = fileId.replace(/\\/g, "/");
  const basename = normalized.split("/").pop() ?? "";
  // Configuration modules are consumed by their host tool, not by local
  // JavaScript member reads. Keep this policy built in rather than requiring a
  // framework plugin to opt each config file out individually.
  if (/(?:^|\/)(?:config|configs|configuration)(?:\/|$)/i.test(normalized)) return true;
  if (/(?:^|\/)[^/]+\.config(?:\.[cm]?[jt]sx?)?$/i.test(normalized)) return true;
  if (basename.startsWith("stylelint.config.")) return true;
  if (normalized.includes("/.storybook/") && basename.startsWith("preview.")) return true;
  if (objectName === "metadata" && /(?:^|\/)app\/layout\.[cm]?[jt]sx?$/.test(normalized)) return true;
  return false;
}

export const ObjectMemberPlugin: AnalyzerPlugin = {
  name: "object-member-plugin",
  version: "1.2.0",

  lifecycle: {
    /**
     * Resets state before a new analysis run starts.
     */
    onProjectInit: async () => {
      state.reset();
    },

    /**
     * Scans AST nodes for exported object definitions and member usages.
     */
    onASTNode: (node: any, fileId: string, adapter?: PluginAdapter) => {
      // 1. Erfassen: Named Exports -> export const config = { key: value }
      if (
        (t.isExportNamedDeclaration(node) || node.type === "ExportNamedDeclaration") &&
        node.declaration?.type === "VariableDeclaration"
      ) {
        for (const decl of node.declaration.declarations) {
          if (t.isIdentifier(decl.id) && t.isObjectExpression(decl.init)) {
            const objName = decl.id.name;
            const members = extractObjectMembers(decl.init);

            if (members.size > 0) {
              state.definitions.set(objName, {
                fileId,
                members,
                loc: decl.id.loc || node.loc
              });
            }
          }
        }
      }

      // 2. Erfassen: Default Exports -> export default { key: value }
      if (
        (t.isExportDefaultDeclaration(node) || node.type === "ExportDefaultDeclaration") &&
        t.isObjectExpression(node.declaration)
      ) {
        const members = extractObjectMembers(node.declaration);
        if (members.size > 0) {
          state.definitions.set("default", {
            fileId,
            members,
            loc: node.loc
          });
        }
      }

      // 3. Track simple value-flow aliases: const router = expressRouter,
      // const routers = [expressRouter], and map callbacks over that array.
      if (node.type === "VariableDeclarator" && t.isIdentifier(node.id)) {
        if (t.isIdentifier(node.init)) {
          state.addAlias(node.id.name, node.init.name);
        } else if (node.init?.type === "LogicalExpression") {
          for (const operand of [node.init.left, node.init.right]) {
            if (t.isIdentifier(operand)) state.addAlias(node.id.name, operand.name);
          }
        } else if (node.init?.type === "ArrayExpression") {
          for (const element of node.init.elements ?? []) {
            if (t.isIdentifier(element)) state.addAlias(node.id.name, element.name);
          }
        }
      }
      if (
        node.type === "CallExpression" &&
        node.callee?.type === "MemberExpression" &&
        !node.callee.computed &&
        t.isIdentifier(node.callee.object) &&
        t.isIdentifier(node.callee.property) &&
        node.callee.property.name === "map"
      ) {
        const callback = node.arguments?.[0];
        const parameter = callback?.params?.[0];
        if (parameter && t.isIdentifier(parameter) && t.isIdentifier(node.callee.object)) {
          for (const target of state.resolveAliases(node.callee.object.name)) {
            state.addAlias(parameter.name, target);
          }
        }
      }

      // 4. Tracking: Member Access -> obj.prop or obj?.prop
      if (
        node.type === "MemberExpression" ||
        node.type === "OptionalMemberExpression"
      ) {
        const objectNames = t.isIdentifier(node.object)
          ? state.resolveAliases(node.object.name)
          : new Set<string>();
        if (!node.computed && t.isIdentifier(node.property)) {
          for (const objectName of objectNames) state.usages.add(`${objectName}.${node.property.name}`);
        } else if (node.computed && t.isStringLiteral(node.property)) {
          for (const objectName of objectNames) state.usages.add(`${objectName}.${node.property.value}`);
        } else if (node.computed) {
          // A dynamic key such as `map[tagName]` may read any property.
          // Do not report statically declared members as unused in that case.
          for (const objectName of objectNames) state.wildcardObjects.add(objectName);
        }
      }

      // 5. Tracking: Passing an object as a whole to another API hides the
      // member access behind that API. Treat its members as dynamically used.
      if ((node.type === "ObjectProperty" || node.type === "Property") && t.isIdentifier(node.value)) {
        for (const objectName of state.resolveAliases(node.value.name)) state.wildcardObjects.add(objectName);
      }
      if (node.type === "CallExpression") {
        for (const argument of node.arguments ?? []) {
          if (t.isIdentifier(argument)) {
            for (const objectName of state.resolveAliases(argument.name)) state.wildcardObjects.add(objectName);
          }
        }
      }

      // 6. Tracking: Object spread reads an unknown set of members.
      if (node.type === "SpreadElement") {
        if (t.isIdentifier(node.argument)) {
          for (const objectName of state.resolveAliases(node.argument.name)) state.wildcardObjects.add(objectName);
        } else if (node.argument?.type === "MemberExpression" && t.isIdentifier(node.argument.object)) {
          for (const objectName of state.resolveAliases(node.argument.object.name)) state.wildcardObjects.add(objectName);
        }
      }

      // 7. Tracking: Destructuring Access -> const { usedKey } = config
      if (node.type === "VariableDeclarator" && node.id?.type === "ObjectPattern" && t.isIdentifier(node.init)) {
        const objName = node.init.name;
        for (const prop of node.id.properties) {
          if (prop.type === "Property" || prop.type === "ObjectProperty") {
            const keyName = prop.key?.name || prop.key?.value;
            if (keyName) {
              for (const objectName of state.resolveAliases(objName)) {
                state.usages.add(`${objectName}.${keyName}`);
              }
            }
          }
        }
      }
    },

    /**
     * Cross-references registered member usages against exported definitions.
     */
    onAnalysisComplete: async (adapter: PluginAdapter) => {
      for (const [objName, def] of state.definitions.entries()) {
        // Storybook consumes CSF story object members (for example `args`) through
        // its discovery runtime rather than through local JavaScript member access.
        // Treating those members as ordinary data creates false positives.
        if (isStorybookStory(def.fileId)) continue;
        if (isExternalConfigContract(def.fileId, objName)) continue;
        // Entry-point members are opt-in, independently of unused-export
        // reporting. Other package exports remain externally consumable.
        const isEntryPoint = adapter.isEntryPoint(def.fileId);
        if (isEntryPoint && !adapter.getConfig().includeEntryMembers) continue;
        if (!isEntryPoint && adapter.isPublicExport(def.fileId, objName)) continue;

        const aliases = state.resolveAliases(objName);
        const hasWildcardUsage = Array.from(aliases).some((name) => state.wildcardObjects.has(name));
        for (const [memberName, memberLoc] of def.members.entries()) {
          const usageKey = `${objName}.${memberName}`;

          const semanticallyUsed = adapter.isConfigMemberUsed(
            def.fileId,
            objName,
            memberName,
          ) || adapter.isRuntimeMemberUsed(
            def.fileId,
            objName,
            memberName,
          );

          if (!hasWildcardUsage && !state.usages.has(usageKey) && !semanticallyUsed) {
            adapter.emitFinding({
              rule: "unused-member",
              severity: "warning",
              confidence: "high",
              message: `Property '${memberName}' in exported object '${objName}' is never referenced.`,
              file: def.fileId,
              evidence: {
                exportName: objName,
                memberName: memberName,
                location: memberLoc || def.loc
              }
            });
          }
        }
      }

      // Clear state after execution
      state.reset();
    }
  }
};

/**
 * Extracts property names and locations from both ESTree (`Property`) and Babel (`ObjectProperty`/`ObjectMethod`) nodes.
 */
function extractObjectMembers(objectExpr: any): Map<string, any> {
  const members = new Map<string, any>();

  if (!objectExpr?.properties) return members;

  for (const prop of objectExpr.properties) {
    // Standard property: key: value or shorthand { key }
    if (
      prop.type === "Property" ||
      prop.type === "ObjectProperty" ||
      prop.type === "ObjectMethod" ||
      prop.type === "ClassMethod"
    ) {
      const keyName = prop.key?.name || prop.key?.value;
      if (keyName && !prop.computed) {
        members.set(keyName, prop.key?.loc || prop.loc);
      }
    }
  }

  return members;
}

export default ObjectMemberPlugin;