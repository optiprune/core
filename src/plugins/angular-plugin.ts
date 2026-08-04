import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";

/**
 * Angular Plugin
 * Handles Angular-specific decorators and patterns.
 */
export const AngularPlugin: AnalyzerPlugin = {
  name: "angular-plugin",
  version: "1.0.0",
  detect: async (adapter) => {
    const pkg = await adapter.readJson('package.json');
    if (pkg) {
      const hasDep = !!(pkg.dependencies?.['@angular/core'] || pkg.devDependencies?.['@angular/core']);
      if (hasDep) return true;
    }
    
    // Fallback: If we see Angular-like files, enable it
    const angularJson = await adapter.readFile('angular.json');
    return !!angularJson;
  },
  lifecycle: {
    onFileStart: (fileId, adapter) => {
      if (fileId.endsWith('component.ts') || fileId.endsWith('module.ts') || fileId.endsWith('service.ts')) {
        adapter.markAsUsed(fileId);
      }
    },
    onASTNode: (node, fileId, adapter) => {
      // Angular Decorators (Babel parser might put them in 'decorators' or 'modifiers')
      const decorators = (node as any).decorators || (node as any).modifiers?.filter((m: any) => m.type === 'Decorator');
      
      if ((t.isClassDeclaration(node) || t.isClassExpression(node)) && decorators) {
        const hasAngularDecorator = decorators.some((dec: any) => {
          const expr = dec.expression;
          const callee = t.isCallExpression(expr) ? expr.callee : expr;
          const name = t.isIdentifier(callee) ? callee.name : (t.isMemberExpression(callee) && t.isIdentifier(callee.property) ? callee.property.name : null);
          return name && ['Component', 'Directive', 'Injectable', 'NgModule', 'Pipe'].includes(name);
        });

        if (hasAngularDecorator) {
          adapter.markAsUsed(fileId, (node as any).id?.name);
          adapter.markAsUsed(fileId); // Mark the whole file as reachable
        }
      }

      // Input/Output Decorators
      if ((t.isClassProperty(node) || t.isClassMethod(node) || (t as any).isPropertyDefinition?.(node)) && decorators) {
        const isAngularIo = decorators.some((dec: any) => {
          const expr = dec.expression;
          const callee = t.isCallExpression(expr) ? expr.callee : expr;
          const name = t.isIdentifier(callee) ? callee.name : (t.isMemberExpression(callee) && t.isIdentifier(callee.property) ? callee.property.name : null);
          return name && ['Input', 'Output', 'ViewChild', 'ContentChild', 'HostListener', 'HostBinding'].includes(name);
        });

        if (isAngularIo) {
          const key = (node as any).key || (node as any).id;
          if (t.isIdentifier(key)) {
            adapter.markAsUsed(fileId, key.name);
          }
        }
      }
    }
  }
};

export default AngularPlugin;
