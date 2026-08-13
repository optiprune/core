import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const I18NEXT_PARSER_CONFIG_FILES = [
  "i18next-parser.config.js",
  "i18next-parser.config.cjs",
  "i18next-parser.config.mjs",
  "i18next-parser.config.ts",
  "i18next-parser.config.cts",
  "i18next-parser.config.mts",
  "i18next-parser.config.json",
  ".i18next-parser.json"
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

export const I18nextParserPlugin: AnalyzerPlugin = {
  name: "i18next-parser-plugin",
  version: "1.0.0",

  detect: async (adapter) => {
    // 1. Check package.json dependencies, i18next-parser field, or scripts
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies
      };

      if ("i18next-parser" in allDeps || pkg["i18next-parser"]) {
        return true;
      }

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (
          scriptValues.some(
            (s) =>
              typeof s === "string" &&
              (s.includes("i18next-parser ") || s === "i18next-parser" || s.includes("i18next-parser"))
          )
        ) {
          return true;
        }
      }
    }

    // 2. Check for configuration files
    for (const configFile of I18NEXT_PARSER_CONFIG_FILES) {
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
        ...pkg?.peerDependencies
      };

      const hasParserDep = "i18next-parser" in allDeps;

      // 1. Safeguard i18next-parser and i18next in package.json
      if (hasParserDep) {
        adapter.markPackageAsUsed("i18next-parser");
      }
      // The parser package is marked only when its config, script, or import is observed.

      // 2. Protect standalone configuration files
      let hasConfigFile = false;
      for (const configFile of I18NEXT_PARSER_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          hasConfigFile = true;
          adapter.markAsUsed(configFile);
        }
      }

      // 3. Process package.json "i18next-parser" block if present
      let parserConfig: any = null;
      if (pkg?.["i18next-parser"]) {
        hasConfigFile = true;
        adapter.markAsUsed("package.json", "i18next-parser");
        parserConfig = pkg["i18next-parser"];
      }

      // 4. Track npm scripts invoking i18next-parser CLI
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (
            typeof scriptContent === "string" &&
            scriptContent.includes("i18next-parser")
          ) {
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            adapter.markPackageAsUsed("i18next-parser");
          }
        }
      }

      // 5. Inspect JSON-based config files (.i18next-parser.json) for input/output paths
      if (!parserConfig) {
        for (const jsonConfigName of [
          "i18next-parser.config.json",
          ".i18next-parser.json"
        ]) {
          const content = await adapter.readFile(jsonConfigName);
          if (content) {
            const parsed = parseJsonc(content);
            if (parsed) {
              parserConfig = parsed;
              break;
            }
          }
        }
      }

      // 6. Extract input source globs and output paths from configuration
      if (parserConfig && typeof parserConfig === "object") {
        processParserConfigObj(parserConfig, adapter);
      }

      // 7. Report missing dependency if configuration exists without i18next-parser package
      if (hasConfigFile && !hasParserDep) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message:
            "i18next-parser configuration found, but 'i18next-parser' is not listed in package.json.",
          evidence: { hasConfigFile, hasPkgBlock: !!pkg?.["i18next-parser"] }
        });
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Protect i18next-parser configuration files
      if (I18NEXT_PARSER_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("i18next-parser");
      }
    },

    onASTNode: (node: any, fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);
      const isConfigFile = I18NEXT_PARSER_CONFIG_FILES.includes(basename);

      // 1. Detect ESM imports for i18next-parser
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (source === "i18next-parser") {
          adapter.markPackageAsUsed(source);
          adapter.markAsUsed(fileId);
        }
      }

      // 2. Inspect JS/TS configuration files (i18next-parser.config.js / .ts)
      if (isConfigFile) {
        let configExpr: any = null;

        if (t.isExportDefaultDeclaration(node)) {
          adapter.markAsUsed(fileId, "default");
          adapter.markPackageAsUsed("i18next-parser");
          configExpr = node.declaration;
        }

        // CommonJS module.exports = { ... }
        if (
          node?.type === "AssignmentExpression" &&
          node.left?.type === "MemberExpression" &&
          node.left?.object?.name === "module" &&
          node.left?.property?.name === "exports"
        ) {
          adapter.markAsUsed(fileId);
          adapter.markPackageAsUsed("i18next-parser");
          configExpr = node.right;
        }

        if (configExpr) {
          const processObject = (objExpr: any) => {
            if (!t.isObjectExpression(objExpr)) return;

            objExpr.properties.forEach((prop: any) => {
              if (t.isObjectProperty(prop) && t.isIdentifier(prop.key)) {
                // Extract input source paths/globs: input: ['src/**/*.{js,jsx,ts,tsx}']
                if (prop.key.name === "input") {
                  if (t.isArrayExpression(prop.value)) {
                    prop.value.elements.forEach((el: any) => {
                      if (t.isStringLiteral(el)) {
                        adapter.markAsUsed(el.value);
                      }
                    });
                  } else if (t.isStringLiteral(prop.value)) {
                    adapter.markAsUsed(prop.value.value);
                  }
                }

                // Extract output template path: output: 'public/locales/$LOCALE/$NAMESPACE.json'
                if (
                  prop.key.name === "output" &&
                  t.isStringLiteral(prop.value)
                ) {
                  adapter.markAsUsed(prop.value.value);
                }
              }
            });
          };

          if (t.isObjectExpression(configExpr)) {
            processObject(configExpr);
          }
        }
      }
    }
  }
};

function processParserConfigObj(configObj: Record<string, any>, adapter: any): void {
  // Extract input globs
  if (Array.isArray(configObj.input)) {
    configObj.input.forEach((inputGlob: any) => {
      if (typeof inputGlob === "string") {
        adapter.markAsUsed(inputGlob);
      }
    });
  } else if (typeof configObj.input === "string") {
    adapter.markAsUsed(configObj.input);
  }

  // Extract output template path
  if (typeof configObj.output === "string") {
    adapter.markAsUsed(configObj.output);
  }
}

export default I18nextParserPlugin;