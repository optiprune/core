import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";

export const ZodPlugin: AnalyzerPlugin = {
  name: "zod-plugin",
  version: "2.0.0",
  detect: async (adapter) => {
    const pkg = await adapter.readJson('package.json');
    return !!(pkg?.dependencies?.['zod'] || pkg?.devDependencies?.['zod']);
  },
  lifecycle: {
    onASTNode: (node, fileId, adapter) => {
      // Pattern: const User = z.object(...)
      if (t.isVariableDeclarator(node) && t.isIdentifier(node.id)) {
        const init = node.init;
        const isZod = t.isCallExpression(init) && 
          ((t.isMemberExpression(init.callee) && t.isIdentifier(init.callee.object) && (init.callee.object.name === 'z' || init.callee.object.name === 'zod')) ||
           (t.isIdentifier(init.callee) && init.callee.name === 'z'));
        if (isZod) {
          adapter.markAsUsed(fileId, node.id.name);
          adapter.attachMetadata(node, 'isExternalContract', true);
        }
      }

      // Dynamic property access: controller[method]()
      if (t.isMemberExpression(node) && node.computed) {
        if (t.isStringLiteral(node.property)) {
          adapter.markAsUsed(fileId, node.property.value);
        }
      }
    }
  }
};

export default ZodPlugin;
