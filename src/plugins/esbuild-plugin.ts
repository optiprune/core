import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";

const ESBUILD_CONFIG_FILES = [
  "esbuild.config.js",
  "esbuild.config.mjs",
  "esbuild.config.ts",
  "esbuild.config.cjs",
  "build.js",
  "build.ts",
  "build.mjs",
  "build.cjs"
];

const ESBUILD_METHODS = new Set([
  "build",
  "buildSync",
  "context",
  "transform",
  "transformSync",
  "serve",
  "analyzeMetafile",
  "formatMessages",
  "initialize"
]);

/**
 * Extracts entry point file paths from esbuild entryPoints option.
 * Handles strings, arrays of strings/objects, and key-value objects.
 */
function extractEntryPoints(val: any, adapter: any): void {
  if (!val) return;

  // Single string: entryPoints: 'src/index.ts'
  if (t.isStringLiteral(val)) {
    adapter.markAsUsed(val.value);
    return;
  }

  // Array: entryPoints: ['src/a.ts', { in: 'src/b.ts', out: 'b' }]
  if (t.isArrayExpression(val)) {
    val.elements.forEach((el: any) => {
      if (!el) return;
      if (t.isStringLiteral(el)) {
        adapter.markAsUsed(el.value);
      } else if (t.isObjectExpression(el)) {
        el.properties.forEach((p: any) => {
          const k = p.key?.name || p.key?.value;
          if (k === "in" && t.isStringLiteral(p.value)) {
            adapter.markAsUsed(p.value.value);
          }
        });
      }
    });
    return;
  }

  // Object map: entryPoints: { out1: 'src/entry1.ts', out2: 'src/entry2.ts' }
  if (t.isObjectExpression(val)) {
    val.properties.forEach((p: any) => {
      if (t.isObjectProperty(p)) {
        if (t.isStringLiteral(p.value)) {
          adapter.markAsUsed(p.value.value);
        } else if (t.isObjectExpression(p.value)) {
          // entryPoints: { out1: { in: 'src/entry1.ts' } }
          p.value.properties.forEach((subP: any) => {
            const subK = subP.key?.name || subP.key?.value;
            if (subK === "in" && t.isStringLiteral(subP.value)) {
              adapter.markAsUsed(subP.value.value);
            }
          });
        }
      }
    });
  }
}

export const ESBuildPlugin: AnalyzerPlugin = {
  name: "esbuild-plugin",
  version: "1.2.0",

  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const hasDep = !!(pkg.dependencies?.["esbuild"] || pkg.devDependencies?.["esbuild"]);
      if (hasDep) return true;
    }

    for (const configPath of ESBUILD_CONFIG_FILES) {
      if (await adapter.folderExists(configPath)) {
        return true;
      }
    }

    return false;
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      const hasEsbuildDep = pkg ? !!(pkg.dependencies?.["esbuild"] || pkg.devDependencies?.["esbuild"]) : false;

      let hasConfigFile = false;
      for (const file of ESBUILD_CONFIG_FILES) {
        if (await adapter.folderExists(file)) {
          hasConfigFile = true;
          adapter.markAsUsed(file);
          break;
        }
      }

      if (pkg?.scripts) {
        for (const [name, script] of Object.entries(pkg.scripts)) {
          if (typeof script === "string" && script.includes("esbuild")) {
            adapter.markAsUsed("package.json", `scripts:${name}`);
            adapter.markPackageAsUsed("esbuild");

            // Extract CLI files (ignoring flags like --bundle or --outdir=dist)
            const tokens = script.split(/\s+/);
            for (const token of tokens) {
              const cleanToken = token.replace(/['"]/g, "");
              if (
                !cleanToken.startsWith("-") &&
                /\.[jt]sx?$/.test(cleanToken)
              ) {
                adapter.markAsUsed(cleanToken);
              }
            }
          }
        }
      }

      if (hasConfigFile && !hasEsbuildDep) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message: "esbuild config found but 'esbuild' is not listed in package.json.",
          evidence: { hasConfigFile }
        });
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");

      // Match exact root/config build files
      if (ESBUILD_CONFIG_FILES.some((pattern) => normalized.endsWith(`/${pattern}`) || normalized === pattern)) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("esbuild");
      }
    },

    onASTNode: (node, fileId, adapter) => {
      // 1. Detect esbuild ESM imports
      if (t.isImportDeclaration(node)) {
        if (node.source.value === "esbuild") {
          adapter.markAsUsed(fileId);
          adapter.markPackageAsUsed("esbuild");
        }
      }

      // 2. Detect require('esbuild')
      if (t.isCallExpression(node) && t.isIdentifier(node.callee) && node.callee.name === "require") {
        const arg = node.arguments[0];
        if (t.isStringLiteral(arg) && arg.value === "esbuild") {
          adapter.markAsUsed(fileId);
          adapter.markPackageAsUsed("esbuild");
        }
      }

      // 3. Detect esbuild API calls & entryPoints extraction
      if (t.isCallExpression(node)) {
        let methodName: string | null = null;

        // Matches esbuild.build(...) or esbuild.context(...)
        if (t.isMemberExpression(node.callee)) {
          const prop = (node.callee as any).property;
          if (t.isIdentifier(prop) && ESBUILD_METHODS.has(prop.name)) {
            methodName = prop.name;
          }
        } 
        // Matches direct call build(...) or context(...)
        else if (t.isIdentifier(node.callee) && ESBUILD_METHODS.has(node.callee.name)) {
          methodName = node.callee.name;
        }

        if (methodName) {
          adapter.markAsUsed(fileId);
          adapter.markPackageAsUsed("esbuild");

          // Process config object passed into build({ ... }) or context({ ... })
          if (node.arguments.length > 0) {
            const configArg = node.arguments[0];
            if (t.isObjectExpression(configArg)) {
              configArg.properties.forEach((prop: any) => {
                const keyName = prop.key?.name || prop.key?.value;
                if (keyName === "entryPoints") {
                  extractEntryPoints(prop.value, adapter);
                }
              });
            }
          }
        }
      }
    }
  }
};

export default ESBuildPlugin;