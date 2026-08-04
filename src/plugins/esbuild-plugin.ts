import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";

/**
 * ESBuild Plugin
 * Handles ESBuild-specific patterns: esbuild.config.js, CLI usage, and build script references
 * This plugin detects esbuild packages used via configuration files and build scripts
 */
export const ESBuildPlugin: AnalyzerPlugin = {
  name: "esbuild-plugin",
  version: "1.0.0",
  detect: async (adapter) => {
    const pkg = await adapter.readJson('package.json');
    if (pkg) {
      const hasDep = !!(pkg.dependencies?.['esbuild'] || pkg.devDependencies?.['esbuild']);
      if (hasDep) return true;
    }

    // Fallback: Check for esbuild config files
    const esbuildConfig = await adapter.readFile('esbuild.config.js') ||
                         await adapter.readFile('esbuild.config.mjs') ||
                         await adapter.readFile('esbuild.config.ts');
    return !!esbuildConfig;
  },
  lifecycle: {
    onFileStart: (fileId, adapter) => {
      // Mark esbuild config files as entry points
      const esbuildConfigFiles = [
        'esbuild.config.js',
        'esbuild.config.mjs',
        'esbuild.config.ts',
        'esbuild.config.cjs'
      ];

      if (esbuildConfigFiles.some(pattern => fileId.endsWith(pattern))) {
        adapter.markAsUsed(fileId);
      }

      // Mark build script files that use esbuild
      if (fileId.endsWith('build.js') || fileId.endsWith('build.ts') || fileId.endsWith('build.mjs')) {
        adapter.markAsUsed(fileId);
      }
    },
    onASTNode: (node, fileId, adapter) => {
      // Detect esbuild API usage: build(), buildSync(), transform(), transformSync()
      if (t.isCallExpression(node)) {
        // esbuild.build(), esbuild.buildSync(), etc.
        if (t.isMemberExpression(node.callee)) {
          const obj = (node.callee as any).object;
          const prop = (node.callee as any).property;
          if (t.isIdentifier(obj) && t.isIdentifier(prop)) {
            const esbuildMethods = [
              'build',
              'buildSync',
              'transform',
              'transformSync',
              'serve',
              'analyzeMetafile',
              'formatMessages',
              'initialize'
            ];
            if (esbuildMethods.includes(prop.name)) {
              adapter.markAsUsed(fileId);
            }
          }
        }

        // Direct esbuild function calls
        if (t.isIdentifier(node.callee)) {
          const funcName = node.callee.name;
          if (['build', 'buildSync', 'transform', 'transformSync', 'serve'].includes(funcName)) {
            adapter.markAsUsed(fileId);
          }
        }
      }

      // Detect esbuild import statements
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (source === 'esbuild') {
          adapter.markAsUsed(fileId);
        }
      }

      // Detect esbuild require statements
      if (t.isCallExpression(node) && t.isIdentifier(node.callee)) {
        if (node.callee.name === 'require') {
          const arg = node.arguments[0];
          if (t.isStringLiteral(arg) && arg.value === 'esbuild') {
            adapter.markAsUsed(fileId);
          }
        }
      }

      // Detect esbuild plugin definitions
      if (t.isObjectProperty(node)) {
        const key = (node as any).key;
        if (t.isIdentifier(key) && ['plugins', 'loader', 'format', 'target'].includes(key.name)) {
          adapter.markAsUsed(fileId);
        }
      }

      // Detect esbuild configuration object
      if (t.isObjectExpression(node)) {
        const properties = (node as any).properties;
        const esbuildConfigKeys = ['entryPoints', 'outfile', 'outdir', 'bundle', 'minify', 'sourcemap', 'target', 'format', 'loader', 'plugins', 'external', 'define', 'inject', 'banner', 'footer', 'globalName', 'assetNames', 'chunkNames', 'entryNames'];
        
        const hasEsbuildConfig = properties?.some((prop: any) => {
          const key = prop.key?.name;
          return esbuildConfigKeys.includes(key);
        });

        if (hasEsbuildConfig) {
          adapter.markAsUsed(fileId);
        }
      }

      // Detect esbuild plugin object pattern
      if (t.isObjectExpression(node)) {
        const properties = (node as any).properties;
        const hasPluginPattern = properties?.some((prop: any) => {
          const key = prop.key?.name;
          return ['setup', 'name'].includes(key);
        });

        if (hasPluginPattern) {
          adapter.markAsUsed(fileId);
        }
      }
    }
  }
};

export default ESBuildPlugin;
