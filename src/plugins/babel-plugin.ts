import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";

/**
 * Babel Plugin
 * Handles Babel-specific patterns: babel.config.js, .babelrc, CLI usage, and preset/plugin references
 * This plugin detects Babel packages used via configuration files and build scripts
 */
export const BabelPlugin: AnalyzerPlugin = {
  name: "babel-plugin",
  version: "1.0.0",
  detect: async (adapter) => {
    const pkg = await adapter.readJson('package.json');
    if (pkg) {
      const hasDep = !!(
        pkg.dependencies?.['@babel/core'] ||
        pkg.dependencies?.['@babel/cli'] ||
        pkg.devDependencies?.['@babel/core'] ||
        pkg.devDependencies?.['@babel/cli']
      );
      if (hasDep) return true;
    }

    // Fallback: Check for Babel config files
    const babelConfig = await adapter.readFile('babel.config.js') ||
                       await adapter.readFile('babel.config.cjs') ||
                       await adapter.readFile('.babelrc') ||
                       await adapter.readFile('.babelrc.js') ||
                       await adapter.readFile('.babelrc.cjs');
    return !!babelConfig;
  },
  lifecycle: {
    onFileStart: (fileId, adapter) => {
      // Mark Babel config files as entry points
      const babelConfigFiles = [
        'babel.config.js',
        'babel.config.cjs',
        'babel.config.mjs',
        '.babelrc',
        '.babelrc.js',
        '.babelrc.cjs',
        '.babelrc.json'
      ];

      if (babelConfigFiles.some(pattern => fileId.endsWith(pattern))) {
        adapter.markAsUsed(fileId);
      }
    },
    onASTNode: (node, fileId, adapter) => {
      // Detect Babel preset/plugin usage in config files
      if (fileId.includes('babel.config') || fileId.includes('.babelrc')) {
        // Mark @babel/preset-* and @babel/plugin-* as used
        if (t.isStringLiteral(node)) {
          const value = node.value;
          if (value.includes('@babel/preset-') || value.includes('@babel/plugin-')) {
            adapter.markAsUsed(fileId);
          }
        }

        // Detect preset/plugin object references
        if (t.isObjectProperty(node) || t.isObjectMethod(node)) {
          const key = (node as any).key;
          if (t.isIdentifier(key) && ['presets', 'plugins'].includes(key.name)) {
            adapter.markAsUsed(fileId);
          }
        }
      }

      // Detect Babel API usage in source files
      if (t.isCallExpression(node)) {
        // @babel/core API: transformFileSync, transformSync, parseSync, etc.
        if (t.isMemberExpression(node.callee)) {
          const obj = (node.callee as any).object;
          const prop = (node.callee as any).property;
          if (t.isIdentifier(obj) && t.isIdentifier(prop)) {
            const babelMethods = [
              'transformFileSync',
              'transformSync',
              'parseSync',
              'transformFile',
              'transform',
              'parse'
            ];
            if (babelMethods.includes(prop.name)) {
              adapter.markAsUsed(fileId);
            }
          }
        }

        // Direct Babel function calls
        if (t.isIdentifier(node.callee)) {
          const funcName = node.callee.name;
          if (['transformFileSync', 'transformSync', 'parseSync', 'transform', 'parse'].includes(funcName)) {
            adapter.markAsUsed(fileId);
          }
        }
      }

      // Detect @babel/traverse usage
      if (t.isCallExpression(node) && t.isIdentifier(node.callee)) {
        if (node.callee.name === 'traverse') {
          adapter.markAsUsed(fileId);
        }
      }

      // Detect @babel/types usage (t.isXxx, t.createXxx patterns)
      if (t.isMemberExpression(node)) {
        const obj = (node as any).object;
        const prop = (node as any).property;
        if (t.isIdentifier(obj) && obj.name === 't' && t.isIdentifier(prop)) {
          const typeMethods = ['is', 'create', 'clone', 'removeProperties', 'removePropertiesDeep'];
          if (typeMethods.some(method => prop.name.startsWith(method))) {
            adapter.markAsUsed(fileId);
          }
        }
      }

      // Detect @babel/helper-* usage
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (source.includes('@babel/helper-')) {
          adapter.markAsUsed(fileId);
        }
      }

      // Detect @babel/plugin-proposal-* and @babel/plugin-transform-* usage
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (source.includes('@babel/plugin-')) {
          adapter.markAsUsed(fileId);
        }
      }

      // Detect @babel/preset-* usage
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (source.includes('@babel/preset-')) {
          adapter.markAsUsed(fileId);
        }
      }
    }
  }
};

export default BabelPlugin;
