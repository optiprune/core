import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";

export const MswPlugin: AnalyzerPlugin = {
  name: "msw-plugin",
  version: "1.0.0",
  detect: async (adapter) => {
    const pkg = await adapter.readJson('package.json');
    return !!(pkg?.devDependencies?.['msw'] || pkg?.dependencies?.['msw']);
  },
  lifecycle: {
    onFileStart: (fileId, adapter) => {
      if (fileId.includes('handlers') || fileId.includes('mocks/')) {
        adapter.markAsUsed(fileId);
      }
    },
    onASTNode: (node, fileId, adapter) => {
      if (t.isCallExpression(node) && t.isMemberExpression(node.callee)) {
        const objName = (node.callee.object as any).name;
        if (['rest', 'http', 'graphql'].includes(objName )) {
          const handler = node.arguments[1];
          if (t.isIdentifier(handler)) {
            adapter.markAsUsed(fileId, handler.name);
          }
        }
      }
    }
  }
};

export default MswPlugin;