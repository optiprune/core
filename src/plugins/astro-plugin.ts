import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const ASTRO_CONFIG_FILES = ["astro.config.mjs", "astro.config.js", "astro.config.ts", "astro.config.cjs"];

/**
 * Astro Plugin
 * Handles Astro-specific patterns: .astro components, API routes, layouts, etc.
 */
export const AstroPlugin: AnalyzerPlugin = {
  name: "astro-plugin",
  version: "1.1.0",
  detect: async (adapter) => {
    const pkg = await adapter.readJson('package.json');
    if (pkg && (pkg.dependencies?.['astro'] || pkg.devDependencies?.['astro'])) {
      return true;
    }
    for (const file of ASTRO_CONFIG_FILES) {
      if ((await adapter.readFile(file)) !== null) return true;
    }
    return false;
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson('package.json');
      const hasAstroDep = pkg ? !!(pkg.dependencies?.['astro'] || pkg.devDependencies?.['astro']) : false;
      
      let hasConfigFile = false;
      for (const file of ASTRO_CONFIG_FILES) {
        if ((await adapter.readFile(file)) !== null) {
          hasConfigFile = true;
          break;
        }
      }

      if (hasConfigFile && !hasAstroDep) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message: "Astro configuration found but 'astro' is not listed in package.json.",
          evidence: { hasConfigFile }
        });
      }
    },
    onFileStart: (fileId, adapter) => {
      // Mark Astro conventional files as entry points
      const astroPatterns = ['.astro', 'pages/', 'layouts/', 'components/', 'api/'];
      if (astroPatterns.some(pattern => fileId.includes(pattern) || fileId.endsWith(pattern))) {
        adapter.markAsUsed(fileId);
      }
      const fileName = path.basename(fileId);
      if (ASTRO_CONFIG_FILES.includes(fileName)) {
        adapter.markAsUsed(fileId);
      }
    },
    onASTNode: (node, fileId, adapter) => {
      // Astro API exports
      if (t.isExportNamedDeclaration(node) && node.declaration) {
        const decl = node.declaration;
        if (t.isFunctionDeclaration(decl) && decl.id) {
          const funcName = decl.id.name;
          if (['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS', 'getStaticPaths'].includes(funcName)) {
            adapter.markAsUsed(fileId, funcName);
          }
        }
      }

      // Astro.props, Astro.redirect, Astro.response
      if (t.isIdentifier(node) && node.name === 'Astro') {
        adapter.markAsUsed(fileId);
      }

      // Astro client-side directives
      if (t.isJSXAttribute(node)) {
        const attrName = (node.name as any).name;
        if (attrName && attrName.startsWith('client:')) {
          adapter.markAsUsed(fileId);
        }
      }

      // Astro.glob()
      if (t.isCallExpression(node) && t.isMemberExpression(node.callee)) {
        const obj = (node.callee as any).object;
        const prop = (node.callee as any).property;
        if (t.isIdentifier(obj) && obj.name === 'Astro' && t.isIdentifier(prop) && prop.name === 'glob') {
          adapter.markAsUsed(fileId);
        }
      }
      
      // Handle astro.config.mjs exports
      const fileName = path.basename(fileId);
      if (ASTRO_CONFIG_FILES.includes(fileName)) {
        if (node.type === "ExportDefaultDeclaration") {
          adapter.markAsUsed(fileId, "default");
        }
      }
    }
  }
};

export default AstroPlugin;
