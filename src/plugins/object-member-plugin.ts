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

  reset() {
    this.definitions.clear();
    this.usages.clear();
  }
}

const state = new MemberTrackerState();

export const ObjectMemberPlugin: AnalyzerPlugin = {
  name: "object-member-plugin",
  version: "1.1.0",

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

      // 3. Tracking: Member Access -> obj.prop or obj?.prop
      if (
        node.type === "MemberExpression" ||
        node.type === "OptionalMemberExpression"
      ) {
        // Direct Dot Access: obj.key
        if (!node.computed && t.isIdentifier(node.property) && t.isIdentifier(node.object)) {
          state.usages.add(`${node.object.name}.${node.property.name}`);
        }
        // Bracket Access with String Literal: obj["key"]
        else if (node.computed && t.isStringLiteral(node.property) && t.isIdentifier(node.object)) {
          state.usages.add(`${node.object.name}.${node.property.value}`);
        }
      }

      // 4. Tracking: Destructuring Access -> const { usedKey } = config
      if (node.type === "VariableDeclarator" && node.id?.type === "ObjectPattern" && t.isIdentifier(node.init)) {
        const objName = node.init.name;
        for (const prop of node.id.properties) {
          if (prop.type === "Property" || prop.type === "ObjectProperty") {
            const keyName = prop.key?.name || prop.key?.value;
            if (keyName) {
              state.usages.add(`${objName}.${keyName}`);
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
        for (const [memberName, memberLoc] of def.members.entries()) {
          const usageKey = `${objName}.${memberName}`;

          if (!state.usages.has(usageKey)) {
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