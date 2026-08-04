import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";

/**
 * Astro Plugin
 * Handles Astro-specific patterns: .astro components, API routes, layouts, etc.
 */
export const AstroPlugin: AnalyzerPlugin = {
  name: "astro-plugin",
  version: "1.0.0",
  detect: async (adapter) => {
    const pkg = await adapter.readJson('package.json');
    if (pkg) {
      const hasDep = !!(pkg.dependencies?.['astro'] || pkg.devDependencies?.['astro']);
      if (hasDep) return true;
    }
    // Fallback: If we see astro.config.mjs, enable it
    const astroConfig = await adapter.readFile('astro.config.mjs');
    return !!astroConfig;
  },
  lifecycle: {
    onFileStart: (fileId, adapter) => {
      // Mark Astro conventional files as entry points
      const astroPatterns = [
        '.astro',
        'pages/', 'layouts/', 'components/', 'api/'
      ];

      if (astroPatterns.some(pattern => fileId.includes(pattern) || fileId.endsWith(pattern))) {
        adapter.markAsUsed(fileId);
      }

      // Mark .astro files
      if (fileId.endsWith('.astro')) {
        adapter.markAsUsed(fileId);
      }

      // Mark API route files
      if (fileId.includes('pages/api/') || fileId.includes('api/')) {
        adapter.markAsUsed(fileId);
      }
    },
    onASTNode: (node, fileId, adapter) => {
      // Astro API exports (GET, POST, PUT, DELETE, PATCH, etc.)
      if (t.isExportNamedDeclaration(node)) {
        if (t.isFunctionDeclaration(node.declaration) || t.isFunctionExpression(node.declaration)) {
          const funcName = (node.declaration as any).id?.name;
          if (funcName && ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'].includes(funcName)) {
            adapter.markAsUsed(fileId, funcName);
          }
        }
      }

      // Astro getStaticPaths
      if (t.isExportNamedDeclaration(node)) {
        if (t.isFunctionDeclaration(node.declaration) || t.isFunctionExpression(node.declaration)) {
          const funcName = (node.declaration as any).id?.name;
          if (funcName === 'getStaticPaths') {
            adapter.markAsUsed(fileId, funcName);
          }
        }
      }

      // Astro.props, Astro.redirect, Astro.response
      if (t.isIdentifier(node) && node.name === 'Astro') {
        adapter.markAsUsed(fileId);
      }

      // Astro client-side directives (client:load, client:idle, etc.)
      if (t.isJSXAttribute(node)) {
        const attrName = (node.name as any).name;
        if (attrName && attrName.startsWith('client:')) {
          adapter.markAsUsed(fileId);
        }
      }

      // Astro slots
      if (t.isJSXElement(node) && t.isJSXIdentifier(node.openingElement.name)) {
        const tagName = (node.openingElement.name as any).name;
        if (tagName === 'slot') {
          adapter.markAsUsed(fileId);
        }
      }

      // Astro.glob() for dynamic imports
      if (t.isCallExpression(node) && t.isMemberExpression(node.callee)) {
        const obj = (node.callee as any).object;
        const prop = (node.callee as any).property;
        if (t.isIdentifier(obj) && obj.name === 'Astro' && t.isIdentifier(prop) && prop.name === 'glob') {
          adapter.markAsUsed(fileId);
        }
      }
    }
  }
};

export default AstroPlugin;
