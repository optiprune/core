import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";

/**
 * NestJS Plugin
 * Handles NestJS-specific decorators: @Controller, @Injectable, @Module, @Guard, @Interceptor, etc.
 */
export const NestJsPlugin: AnalyzerPlugin = {
  name: "nestjs-plugin",
  version: "1.0.0",
  detect: async (adapter) => {
    const pkg = await adapter.readJson('package.json');
    if (pkg) {
      const hasDep = !!(pkg.dependencies?.['@nestjs/core'] || pkg.devDependencies?.['@nestjs/core']);
      if (hasDep) return true;
    }
    // Fallback: If we see nest-cli.json, enable it
    const nestCli = await adapter.readFile('nest-cli.json');
    return !!nestCli;
  },
  lifecycle: {
    onFileStart: (fileId, adapter) => {
      // Mark NestJS module files as entry points
      if (fileId.endsWith('.module.ts') || fileId.endsWith('.controller.ts') || fileId.endsWith('.service.ts')) {
        adapter.markAsUsed(fileId);
      }
    },
    onASTNode: (node, fileId, adapter) => {
      // NestJS Decorators (Babel parser might put them in 'decorators' or 'modifiers')
      const decorators = (node as any).decorators || (node as any).modifiers?.filter((m: any) => m.type === 'Decorator');
      
      if ((t.isClassDeclaration(node) || t.isClassExpression(node)) && decorators) {
        const hasNestJsDecorator = decorators.some((dec: any) => {
          const expr = dec.expression;
          const callee = t.isCallExpression(expr) ? expr.callee : expr;
          const name = t.isIdentifier(callee) ? callee.name : (t.isMemberExpression(callee) && t.isIdentifier(callee.property) ? callee.property.name : null);
          return name && ['Controller', 'Injectable', 'Module', 'Guard', 'Interceptor', 'Pipe', 'Filter', 'Middleware'].includes(name);
        });

        if (hasNestJsDecorator) {
          adapter.markAsUsed(fileId, (node as any).id?.name);
          adapter.markAsUsed(fileId);
        }
      }

      // NestJS method decorators (@Get, @Post, @Put, @Delete, @Patch, etc.)
      if (t.isClassMethod(node) && decorators) {
        const hasRouteDecorator = decorators.some((dec: any) => {
          const expr = dec.expression;
          const callee = t.isCallExpression(expr) ? expr.callee : expr;
          const name = t.isIdentifier(callee) ? callee.name : null;
          return name && ['Get', 'Post', 'Put', 'Delete', 'Patch', 'Options', 'Head'].includes(name);
        });

        if (hasRouteDecorator) {
          adapter.markAsUsed(fileId, (node as any).key?.name);
        }
      }

      // NestJS dependency injection via @Inject decorator
      if (t.isClassProperty(node) && decorators) {
        const hasInjectDecorator = decorators.some((dec: any) => {
          const expr = dec.expression;
          const name = t.isIdentifier(expr) ? expr.name : (t.isCallExpression(expr) && t.isIdentifier(expr.callee) ? expr.callee.name : null);
          return name === 'Inject';
        });

        if (hasInjectDecorator) {
          adapter.markAsUsed(fileId, (node as any).key?.name);
        }
      }
    }
  }
};

export default NestJsPlugin;
