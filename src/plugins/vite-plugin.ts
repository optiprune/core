import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const VITE_CONFIG_FILES = [
  "vite.config.js",
  "vite.config.ts",
  "vite.config.mjs",
  "vite.config.cjs",
  "vite.config.mts",
  "vite.config.cts"
];

const VITE_CORE_PACKAGES = [
  "vite",
  "@nx/vite",
  "@vitejs/plugin-vue",
  "@vitejs/plugin-vue-jsx",
  "@vitejs/plugin-react",
  "@vitejs/plugin-react-swc",
  "@vitejs/plugin-legacy"
];

export const VitePlugin: AnalyzerPlugin = {
  name: "vite-plugin",
  version: "1.2.0",

  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies
      };
      if (VITE_CORE_PACKAGES.some((pkgName) => pkgName in allDeps)) {
        return true;
      }
    }

    for (const configFile of VITE_CONFIG_FILES) {
      if (await adapter.folderExists(configFile)) return true;
    }

    return await adapter.folderExists("index.html");
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      const allDeps = {
        ...pkg?.dependencies,
        ...pkg?.devDependencies,
        ...pkg?.peerDependencies
      };

            const hasViteDep = VITE_CORE_PACKAGES.some((p) => p in allDeps);
      let hasConfigFile = false;
      for (const configFile of VITE_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          hasConfigFile = true;
          adapter.markAsUsed(configFile);
          break;
        }
      }

      // If we have a config but no core package, mark the core package as missing
      if (hasConfigFile && !hasViteDep) {
        // If it's an Nx workspace (nx.json exists), suggest @nx/vite, otherwise vite
        if (await adapter.folderExists("nx.json")) {
          adapter.markPackageAsUsed("@nx/vite"); // This will trigger missing-dependency if not in package.json
        } else {
          adapter.markPackageAsUsed("vite");
        }
      }

      // Safeguard installed Vite ecosystem packages in package.json
      if (hasViteDep) {
        for (const vitePkg of VITE_CORE_PACKAGES) {
          if (allDeps[vitePkg]) {
            adapter.markPackageAsUsed(vitePkg);
          }
        }
      }

      // Track npm scripts invoking Vite CLI (e.g. "dev": "vite", "build": "vite build")
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (
            typeof scriptContent === "string" &&
            (scriptContent.includes("vite ") || scriptContent === "vite")
          ) {
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            adapter.markPackageAsUsed("vite");
          }
        }
      }

      if (hasConfigFile && !hasViteDep) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message: "Vite configuration found but 'vite' is not listed in package.json.",
          evidence: { hasConfigFile }
        });
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // 1. Mark Vite config files
      if (VITE_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("vite");
      }

      // 2. Mark default entry points for Vite apps
      if (basename === "index.html") {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("vite");
      }

      const standardEntries = [
        "src/main.ts",
        "src/main.js",
        "src/main.tsx",
        "src/main.jsx",
        "src/index.ts",
        "src/index.js",
        "src/index.tsx",
        "src/index.jsx"
      ];

      if (standardEntries.some((entry) => normalized.endsWith(entry))) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("vite");
      }
    },

    onASTNode: (node, fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);
      const isConfigFile = VITE_CONFIG_FILES.includes(basename);

      // 1. Detect Vite imports in any file
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (source === "vite" || source.startsWith("@vitejs/plugin-")) {
          adapter.markPackageAsUsed(source);
          adapter.markAsUsed(fileId);
        }
      }

      if (!isConfigFile) return;

      // 2. Extract configuration object in vite.config.*
      let configObjectNode: any = null;

      if (t.isExportDefaultDeclaration(node)) {
        if (t.isObjectExpression(node.declaration)) {
          configObjectNode = node.declaration;
        } else if (
          t.isCallExpression(node.declaration) &&
          node.declaration.arguments.length > 0 &&
          t.isObjectExpression(node.declaration.arguments[0])
        ) {
          configObjectNode = node.declaration.arguments[0];
        }
      }

      if (!configObjectNode) return;

      for (const prop of configObjectNode.properties) {
        if (!t.isObjectProperty(prop) || !t.isIdentifier(prop.key)) continue;

        const propName = prop.key.name;

        // build options
        if (propName === "build" && t.isObjectExpression(prop.value)) {
          prop.value.properties.forEach((buildProp: any) => {
            if (!t.isObjectProperty(buildProp) || !t.isIdentifier(buildProp.key)) return;

            // build.lib.entry
            if (buildProp.key.name === "lib" && t.isObjectExpression(buildProp.value)) {
              buildProp.value.properties.forEach((libProp: any) => {
                if (
                  t.isObjectProperty(libProp) &&
                  t.isIdentifier(libProp.key) &&
                  libProp.key.name === "entry"
                ) {
                  if (t.isStringLiteral(libProp.value)) {
                    adapter.markAsUsed(libProp.value.value);
                  } else if (t.isObjectExpression(libProp.value)) {
                    libProp.value.properties.forEach((entryProp: any) => {
                      if (entryProp.value && t.isStringLiteral(entryProp.value)) {
                        adapter.markAsUsed(entryProp.value.value);
                      }
                    });
                  }
                }
              });
            }

            // build.rollupOptions.input
            if (buildProp.key.name === "rollupOptions" && t.isObjectExpression(buildProp.value)) {
              buildProp.value.properties.forEach((rollupProp: any) => {
                if (
                  t.isObjectProperty(rollupProp) &&
                  t.isIdentifier(rollupProp.key) &&
                  rollupProp.key.name === "input"
                ) {
                  const val = rollupProp.value;
                  if (t.isStringLiteral(val)) {
                    adapter.markAsUsed(val.value);
                  } else if (t.isArrayExpression(val)) {
                    val.elements.forEach((el: any) => {
                      if (el && t.isStringLiteral(el)) adapter.markAsUsed(el.value);
                    });
                  } else if (t.isObjectExpression(val)) {
                    val.properties.forEach((inputProp: any) => {
                      if (inputProp.value && t.isStringLiteral(inputProp.value)) {
                        adapter.markAsUsed(inputProp.value.value);
                      }
                    });
                  }
                }
              });
            }
          });
        }

        // resolve.alias
        if (propName === "resolve" && t.isObjectExpression(prop.value)) {
          prop.value.properties.forEach((resolveProp: any) => {
            if (
              t.isObjectProperty(resolveProp) &&
              t.isIdentifier(resolveProp.key) &&
              resolveProp.key.name === "alias"
            ) {
              const aliasVal = resolveProp.value;
              if (t.isObjectExpression(aliasVal)) {
                aliasVal.properties.forEach((aliasProp: any) => {
                  if (aliasProp.value && t.isStringLiteral(aliasProp.value)) {
                    adapter.markAsUsed(aliasProp.value.value);
                  }
                });
              } else if (t.isArrayExpression(aliasVal)) {
                aliasVal.elements.forEach((aliasEl: any) => {
                  if (t.isObjectExpression(aliasEl)) {
                    aliasEl.properties.forEach((p: any) => {
                      if (
                        p.key?.name === "replacement" &&
                        p.value &&
                        t.isStringLiteral(p.value)
                      ) {
                        adapter.markAsUsed(p.value.value);
                      }
                    });
                  }
                });
              }
            }
          });
        }

        // plugins
        if (propName === "plugins" && t.isArrayExpression(prop.value)) {
          prop.value.elements.forEach((plugin: any) => {
            if (t.isCallExpression(plugin) && t.isIdentifier(plugin.callee)) {
              adapter.markAsUsed(fileId);
              adapter.markPackageAsUsed("vite");
            }
          });
        }
      }
    }
  }
};

export default VitePlugin;