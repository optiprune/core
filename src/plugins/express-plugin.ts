import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";

export const ExpressPlugin: AnalyzerPlugin = {
  name: "express-plugin",
  version: "1.0.0",
  detect: async (adapter) => {
    const pkg = await adapter.readJson('package.json');
    return !!(pkg?.dependencies?.['express'] || pkg?.devDependencies?.['express']);
  },
  lifecycle: {
    onASTNode: (node, fileId, adapter) => {
      // Erkennt Express-Methoden: app.get(), router.post(), etc.
      if (t.isCallExpression(node) && t.isMemberExpression(node.callee)) {
        const methodName = (node.callee.property as any).name;
        const expressMethods = ['get', 'post', 'put', 'delete', 'patch', 'use', 'all'];
        
        if (expressMethods.includes(methodName)) {
          node.arguments.forEach(arg => {
            if (t.isIdentifier(arg)) {
              adapter.markAsUsed(fileId, arg.name);
            }
            // In OptiPrune's ast-utils.ts gibt es nur isFunctionExpression
            // (deckt oft auch Arrow Functions im ESTree ab)
            else if (t.isFunctionExpression(arg)) {
              // Markiert als Teil des Pfades
            }
          });
        }
      }
    }
  }
};

export default ExpressPlugin;