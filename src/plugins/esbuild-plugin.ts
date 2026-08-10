import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";

export const ESBuildPlugin: AnalyzerPlugin = {
  name: "esbuild-plugin",
  version: "1.1.0",
  detect: async (adapter) => {
    const pkg = await adapter.readJson('package.json');
    if (pkg) {
      const hasDep = !!(pkg.dependencies?.['esbuild'] || pkg.devDependencies?.['esbuild']);
      if (hasDep) return true;
    }

    // Use folderExists (which supports file paths)
    const configFiles = ['esbuild.config.js', 'esbuild.config.mjs', 'esbuild.config.ts', 'esbuild.config.cjs'];
    for (const configPath of configFiles) {
      if (await adapter.folderExists(configPath)) {
        return true;
      }
    }

    return false;
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      if (pkg?.scripts) {
        for (const [name, script] of Object.entries(pkg.scripts)) {
          if (typeof script === "string" && script.includes("esbuild")) {
            adapter.markAsUsed("package.json", `scripts:${name}`);

            // Extract entry point files passed directly via CLI: e.g. "esbuild src/index.ts --bundle"
            const tokens = script.split(/\s+/);
            for (const token of tokens) {
              if (token.endsWith(".js") || token.endsWith(".ts") || token.endsWith(".jsx") || token.endsWith(".tsx")) {
                adapter.markAsUsed(token);
              }
            }
          }
        }
      }
    },
    onFileStart: (fileId, adapter) => {
      const esbuildConfigFiles = [
        'esbuild.config.js',
        'esbuild.config.mjs',
        'esbuild.config.ts',
        'esbuild.config.cjs'
      ];

      if (esbuildConfigFiles.some(pattern => fileId.endsWith(pattern))) {
        adapter.markAsUsed(fileId);
      }

      if (fileId.endsWith('build.js') || fileId.endsWith('build.ts') || fileId.endsWith('build.mjs')) {
        adapter.markAsUsed(fileId);
      }
    },
    onASTNode: (node, fileId, adapter) => {
      // 1. Detect esbuild API calls: build(), buildSync(), context(), transform(), etc.
      if (t.isCallExpression(node)) {
        let isEsbuildCall = false;

        if (t.isMemberExpression(node.callee)) {
          const obj = (node.callee as any).object;
          const prop = (node.callee as any).property;
          if (t.isIdentifier(obj) && t.isIdentifier(prop)) {
            const esbuildMethods = [
              'build',
              'buildSync',
              'context', // esbuild v0.16+ watch/rebuild API
              'transform',
              'transformSync',
              'serve',
              'analyzeMetafile',
              'formatMessages',
              'initialize'
            ];
            if (esbuildMethods.includes(prop.name)) {
              isEsbuildCall = true;
              adapter.markAsUsed(fileId);
            }
          }
        }

        // 2. Extract referenced entryPoints inside build({ entryPoints: [...] })
        if (isEsbuildCall && node.arguments.length > 0) {
          const configArg = node.arguments[0];
          if (t.isObjectExpression(configArg)) {
            configArg.properties.forEach((prop: any) => {
              const keyName = prop.key?.name || prop.key?.value;
              if (keyName === 'entryPoints') {
                const val = prop.value;
                // Single string or identifier
                if (t.isStringLiteral(val)) {
                  adapter.markAsUsed(val.value);
                } 
                // Array of strings: entryPoints: ['src/index.ts', 'src/cli.ts']
                else if (t.isArrayExpression(val)) {
                  val.elements.forEach((el: any) => {
                    if (t.isStringLiteral(el)) {
                      adapter.markAsUsed(el.value);
                    }
                  });
                }
              }
            });
          }
        }
      }

      // 3. Detect esbuild import statements
      if (t.isImportDeclaration(node)) {
        if (node.source.value === 'esbuild') {
          adapter.markAsUsed(fileId);
        }
      }

      // 4. Detect require('esbuild')
      if (t.isCallExpression(node) && t.isIdentifier(node.callee)) {
        if (node.callee.name === 'require') {
          const arg = node.arguments[0];
          if (t.isStringLiteral(arg) && arg.value === 'esbuild') {
            adapter.markAsUsed(fileId);
          }
        }
      }
    }
  }
};

export default ESBuildPlugin;