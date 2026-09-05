import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const CSPELL_CONFIG_FILES = [
  ".cspell.json",
  "cspell.json",
  ".cSpell.json",
  "cSpell.json",
  ".cspell.jsonc",
  "cspell.jsonc",
  ".cspell.yaml",
  ".cspell.yml",
  "cspell.yaml",
  "cspell.yml",
  ".cspell.config.js",
  ".cspell.config.cjs",
  ".cspell.config.mjs",
  "cspell.config.js",
  "cspell.config.cjs",
  "cspell.config.mjs",
  "cspell.config.ts",
  "cspell.config.yaml",
  "cspell.config.yml",
];

function parseJsonc<T = any>(content: string): T | null {
  try {
    const cleanJson = content
      .replace(/\/\/.*/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/,(\s*[\]}])/g, "$1");
    return JSON.parse(cleanJson);
  } catch {
    return null;
  }
}

export const CspellPlugin: AnalyzerPlugin = {
  name: "cspell-plugin",
  version: "1.0.0",

  detect: async (adapter) => {
    // 1. Check package.json dependencies and cspell field
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies,
      };

      if (
        Object.keys(allDeps).some((dep) => dep === "cspell" || dep.startsWith("@cspell/")) ||
        pkg.cspell
      ) {
        return true;
      }

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (
          scriptValues.some(
            (s) => typeof s === "string" && (s.includes("cspell ") || s === "cspell"),
          )
        ) {
          return true;
        }
      }
    }

    // 2. Check for CSpell configuration files
    for (const configFile of CSPELL_CONFIG_FILES) {
      if (await adapter.folderExists(configFile)) return true;
    }

    return false;
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      const allDeps = {
        ...pkg?.dependencies,
        ...pkg?.devDependencies,
        ...pkg?.peerDependencies,
      };

      const hasCspell = Object.keys(allDeps).some(
        (p) => p === "cspell" || p.startsWith("@cspell/"),
      );

      // 1. Safeguard installed CSpell packages and dictionary packages in package.json
      if (hasCspell) {
        for (const depName of Object.keys(allDeps)) {
          if (depName === "cspell" || depName.startsWith("@cspell/")) {
            // A manifest entry alone is not evidence that this package is used.
            // Usage is marked by the config, script, import, or file hooks below.
          }
        }
      }

      // 2. Protect standalone configuration files
      let hasConfigFile = false;
      for (const configFile of CSPELL_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          hasConfigFile = true;
          adapter.markConfigFileAsUsed(configFile);
        }
      }

      // 3. Process package.json "cspell" block if present
      let cspellConfig: any = null;
      if (pkg?.cspell) {
        hasConfigFile = true;
        adapter.markAsUsed("package.json", "cspell");
        cspellConfig = pkg.cspell;
      }

      // 4. Track npm scripts invoking CSpell CLI
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (
            typeof scriptContent === "string" &&
            (scriptContent.includes("cspell ") || scriptContent === "cspell")
          ) {
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            adapter.markPackageAsUsed("cspell");
          }
        }
      }

      // 5. Inspect JSON-based config files for custom dictionary paths and imports
      if (!cspellConfig) {
        for (const jsonConfigName of [
          ".cspell.json",
          "cspell.json",
          ".cspell.jsonc",
          "cspell.jsonc",
        ]) {
          const content = await adapter.readFile(jsonConfigName);
          if (content) {
            const parsed = parseJsonc(content);
            if (parsed) {
              cspellConfig = parsed;
              break;
            }
          }
        }
      }

      // 6. Extract custom dictionary paths and dictionary npm packages
      if (cspellConfig) {
        processCspellConfigObj(cspellConfig, adapter);
      }

      // 7. Report missing dependency if configuration exists without cspell package
      if (hasConfigFile && !hasCspell) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message: "CSpell configuration found, but 'cspell' is not listed in package.json.",
          evidence: { hasConfigFile, hasPkgBlock: !!pkg?.cspell },
        });
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Protect CSpell configuration files
      if (CSPELL_CONFIG_FILES.includes(basename)) {
        adapter.markConfigFileAsUsed(fileId);
        adapter.markPackageAsUsed("cspell");
      }
    },

    onASTNode: (node: any, fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);
      const isConfigFile = CSPELL_CONFIG_FILES.includes(basename);

      // 1. Detect ESM imports for cspell or @cspell/* packages
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (source === "cspell" || source.startsWith("@cspell/")) {
          adapter.markPackageAsUsed(source);
          adapter.markAsUsed(fileId);
        }
      }

      // 2. In JavaScript CSpell configuration files (cspell.config.js / .cspell.config.js)
      if (isConfigFile) {
        if (t.isExportDefaultDeclaration(node)) {
          adapter.markAsUsed(fileId, "default");
          adapter.markPackageAsUsed("cspell");
        }

        // CommonJS module.exports = { ... }
        if (
          node?.type === "AssignmentExpression" &&
          node.left?.type === "MemberExpression" &&
          node.left?.object?.name === "module" &&
          node.left?.property?.name === "exports"
        ) {
          adapter.markAsUsed(fileId);
          adapter.markPackageAsUsed("cspell");
        }

        // Inspect properties in JS config object
        if (t.isObjectProperty(node)) {
          const keyName = t.isIdentifier(node.key) ? node.key.name : (node.key as any).value;

          // Extract dictionaryDefinitions: [{ path: './custom-words.txt' }]
          if (keyName === "dictionaryDefinitions" && t.isArrayExpression(node.value)) {
            node.value.elements.forEach((el: any) => {
              if (t.isObjectExpression(el)) {
                el.properties.forEach((prop: any) => {
                  if (
                    t.isObjectProperty(prop) &&
                    t.isIdentifier(prop.key) &&
                    prop.key.name === "path" &&
                    t.isStringLiteral(prop.value)
                  ) {
                    adapter.markAsUsed(prop.value.value);
                  }
                });
              }
            });
          }

          // Extract imports: ['./custom-dictionary.json', '@cspell/dict-typescript']
          if (keyName === "imports" && t.isArrayExpression(node.value)) {
            node.value.elements.forEach((el: any) => {
              if (t.isStringLiteral(el)) {
                const importVal = el.value;
                if (importVal.startsWith(".") || importVal.startsWith("/")) {
                  adapter.markAsUsed(importVal);
                } else {
                  adapter.markPackageAsUsed(importVal);
                }
              }
            });
          }
        }
      }
    },
  },
};

function processCspellConfigObj(config: any, adapter: any): void {
  if (typeof config !== "object" || config === null) return;

  // Process dictionaryDefinitions: [{ name: 'custom', path: './words.txt' }]
  if (Array.isArray(config.dictionaryDefinitions)) {
    config.dictionaryDefinitions.forEach((dict: any) => {
      if (typeof dict?.path === "string") {
        adapter.markAsUsed(dict.path);
      }
    });
  }

  // Process imports: ['@cspell/dict-espanol', './local-cspell.json']
  if (Array.isArray(config.imports)) {
    config.imports.forEach((imp: string) => {
      if (typeof imp === "string") {
        if (imp.startsWith(".") || imp.startsWith("/")) {
          adapter.markAsUsed(imp);
        } else {
          adapter.markPackageAsUsed(imp);
        }
      }
    });
  }
}

export default CspellPlugin;
