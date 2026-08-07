import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";

/**
 * React Plugin
 * Handles React-specific patterns like components and hooks.
 */
export const ReactPlugin: AnalyzerPlugin = {
  name: "react-plugin",
  version: "1.2.0",
  detect: async (adapter) => {
    const pkg = await adapter.readJson('package.json');
    if (pkg && (pkg.dependencies?.['react'] || pkg.devDependencies?.['react'] || pkg.peerDependencies?.['react'])) {
      return true;
    }
    // Check for tsconfig.json with jsx support
    const tsconfig = await adapter.readJson('tsconfig.json');
    if (tsconfig?.compilerOptions?.jsx) return true;
    const jsconfig = await adapter.readJson('jsconfig.json');
    if (jsconfig?.compilerOptions?.jsx) return true;
    return false;
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson('package.json');
      const hasReact = pkg ? !!(pkg.dependencies?.['react'] || pkg.devDependencies?.['react'] || pkg.peerDependencies?.['react']) : false;
      
      const config = await adapter.readJson('tsconfig.json') || await adapter.readJson('jsconfig.json');
      if (config?.compilerOptions?.jsx && !hasReact) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "warning",
          confidence: "medium",
          file: "package.json",
          message: "JSX support enabled in config but 'react' is not listed in package.json.",
          evidence: { jsxEnabled: true }
        });
      }
    },
    onASTNode: (node: any, fileId, adapter) => {
      let targetNode = node;

      // Unwrap export declarations
      if (
        (node.type === 'ExportNamedDeclaration' || node.type === 'ExportDefaultDeclaration') &&
        node.declaration
      ) {
        targetNode = node.declaration;
      }

      // 1. Function Declarations: function MyComponent() {}
      if (targetNode.type === 'FunctionDeclaration' && targetNode.id && /^[A-Z]/.test(targetNode.id.name)) {
        adapter.markAsUsed(fileId, targetNode.id.name);
      }

      // 2. Variable Declarations: const MyComponent = () => ... or function expression / JSX
      if (targetNode.type === 'VariableDeclaration' && Array.isArray(targetNode.declarations)) {
        for (const decl of targetNode.declarations) {
          if (decl.id?.type === 'Identifier' && /^[A-Z]/.test(decl.id.name)) {
            const init = decl.init;
            if (
              init &&
              (init.type === 'ArrowFunctionExpression' ||
               init.type === 'FunctionExpression' ||
               init.type === 'JSXElement')
            ) {
              adapter.markAsUsed(fileId, decl.id.name);
            }
          }
        }
      }

      // 3. Hooks: useFoo() call expressions
      if (
        node.type === 'CallExpression' &&
        node.callee?.type === 'Identifier' &&
        typeof node.callee.name === 'string' &&
        node.callee.name.startsWith('use')
      ) {
        adapter.markAsUsed(fileId);
      }
      
      // 4. Components used in JSX
      if (t.isJSXElement(node) && t.isJSXIdentifier(node.openingElement.name)) {
        const componentName = node.openingElement.name.name;
        if (componentName[0] === componentName[0].toUpperCase()) {
          adapter.markAsUsed(fileId, componentName);
        }
      }
    }
  }
};

export default ReactPlugin;
