import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";

export const ZodPlugin: AnalyzerPlugin = {
  name: "zod-plugin",
  version: "1.0.0",
  detect: async (adapter) => {
    const pkg = await adapter.readJson('package.json');
    return !!(pkg?.dependencies?.['zod']);
  },
  lifecycle: {
    onASTNode: (node, fileId, adapter) => {
      // Erkennt Zod-Schemas: const mySchema = z.object({ ... })
      if (t.isVariableDeclarator(node) && t.isCallExpression(node.init)) {
        const callee = node.init.callee;
        if (t.isMemberExpression(callee) && (callee.object as any).name === 'z') {
          adapter.markAsUsed(fileId, (node.id as any).name);
          adapter.attachMetadata(node, 'isExternalContract', true);
        }
      }
    }
  }
};

export default ZodPlugin;