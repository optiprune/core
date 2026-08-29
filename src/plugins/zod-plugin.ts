import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";

/** Unwinds chained call expressions to find the root identifier (e.g., z.object().strict()) */
function getRootIdentifierName(node: any): string | null {
  let curr = node;
  while (curr) {
    if (t.isCallExpression(curr)) {
      curr = curr.callee;
    } else if (t.isMemberExpression(curr)) {
      curr = curr.object;
    } else if (t.isIdentifier(curr)) {
      return curr.name;
    } else {
      break;
    }
  }
  return null;
}

export const ZodPlugin: AnalyzerPlugin = {
  name: "zod-plugin",
  version: "2.0.0",

  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    const allDeps = {
      ...pkg?.dependencies,
      ...pkg?.devDependencies,
      ...pkg?.peerDependencies,
    };
    return "zod" in allDeps;
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      const allDeps = {
        ...pkg?.dependencies,
        ...pkg?.devDependencies,
        ...pkg?.peerDependencies,
      };

      // A package.json declaration alone is not usage evidence. Zod imports
      // and schema expressions are marked in onASTNode below.
    },

    onASTNode: (node: any, fileId, adapter) => {
      // 1. Mark Zod imports
      if (t.isImportDeclaration(node) && node.source.value === "zod") {
        adapter.markPackageAsUsed("zod");
        adapter.markAsUsed(fileId);
      }

      // 2. Pattern: const User = z.object(...).passthrough()
      if (t.isVariableDeclarator(node) && t.isIdentifier(node.id) && node.init) {
        const rootName = getRootIdentifierName(node.init);
        if (rootName === "z" || rootName === "zod") {
          adapter.markAsUsed(fileId, node.id.name);
          adapter.attachMetadata(node, "isExternalContract", true);
          adapter.markPackageAsUsed("zod");
        }
      }
    },
  },
};

export default ZodPlugin;
