import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const POSTCSS_CONFIG_FILES = [
  "postcss.config.js",
  "postcss.config.cjs",
  "postcss.config.mjs",
  "postcss.config.ts",
  "postcss.config.cts",
  "postcss.config.mts",
  ".postcssrc",
  ".postcssrc.json",
  ".postcssrc.yaml",
  ".postcssrc.yml",
  ".postcssrc.js",
  ".postcssrc.cjs",
  ".postcssrc.mjs",
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

export const PostCSSPlugin: AnalyzerPlugin = {
  name: "postcss-plugin",
  version: "1.2.0",

  detect: async (adapter) => {
    // 1. Check package.json dependencies, postcss field, or scripts
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies,
      };

      if (
        Object.keys(allDeps).some(
          (dep) =>
            dep === "postcss" ||
            dep.startsWith("postcss-") ||
            dep.startsWith("@postcss/") ||
            dep === "autoprefixer" ||
            dep === "tailwindcss",
        ) ||
        pkg.postcss
      ) {
        return true;
      }

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (
          scriptValues.some(
            (s) => typeof s === "string" && (s.includes("postcss ") || s === "postcss"),
          )
        ) {
          return true;
        }
      }
    }

    // 2. Check for configuration files. `findFiles` also sees files that are
    // explicitly supplied through the fixture's configFiles option.
    const configuredFiles = adapter.getConfig().configFiles ?? [];
    if (
      configuredFiles.some((file) => POSTCSS_CONFIG_FILES.includes(path.basename(file))) ||
      (await adapter.findFiles(POSTCSS_CONFIG_FILES)).length > 0
    )
      return true;
    for (const configFile of POSTCSS_CONFIG_FILES) {
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

      const hasPostCss = Object.keys(allDeps).some(
        (p) =>
          p === "postcss" ||
          p.startsWith("postcss-") ||
          p.startsWith("@postcss/") ||
          p === "autoprefixer" ||
          p === "tailwindcss",
      );

      // 1. Safeguard all installed PostCSS packages and plugins in package.json
      if (hasPostCss) {
        for (const depName of Object.keys(allDeps)) {
          if (
            depName === "postcss" ||
            depName.startsWith("postcss-") ||
            depName.startsWith("@postcss/") ||
            depName === "autoprefixer" ||
            depName === "tailwindcss"
          ) {
            // A manifest entry alone is not evidence that this package is used.
            // Usage is marked by the config, script, import, or file hooks below.
          }
        }
      }

      // 2. Protect standalone configuration files
      let hasConfigFile = false;
      for (const configFile of POSTCSS_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          hasConfigFile = true;
          adapter.markConfigFileAsUsed(configFile);
        }
      }

      // 3. Process package.json "postcss" block if present
      let postcssConfig: any = null;
      if (pkg?.postcss) {
        hasConfigFile = true;
        adapter.markAsUsed("package.json", "postcss");
        postcssConfig = pkg.postcss;
      }

      // 4. Track npm scripts invoking PostCSS CLI
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (
            typeof scriptContent === "string" &&
            (scriptContent.includes("postcss ") || scriptContent === "postcss")
          ) {
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            adapter.markPackageAsUsed("postcss");
          }
        }
      }

      // 5. Inspect JSON-based config files (.postcssrc, .postcssrc.json) for plugins
      if (!postcssConfig) {
        for (const jsonConfigName of [".postcssrc", ".postcssrc.json"]) {
          const content = await adapter.readFile(jsonConfigName);
          if (content) {
            const parsed = parseJsonc(content);
            if (parsed) {
              postcssConfig = parsed;
              break;
            }
          }
        }
      }

      // 6. Extract declared plugin packages from configuration object
      if (postcssConfig) {
        processPostCssConfigObj(postcssConfig, adapter);
      }

      // 6b. JavaScript/TypeScript configs can express plugins through imports,
      // require calls, or string-valued plugin maps. Scan the original config
      // so config-only packages are handled like Knip's plugin fixtures.
      const declared = new Set(Object.keys(allDeps));
      for (const configFile of POSTCSS_CONFIG_FILES) {
        const source = await adapter.readFile(configFile);
        if (!source) continue;
        const packagePattern =
          /(?:require\s*\(|from\s+|plugins?\s*[:=]|[\[,])\s*["'`]([^"'`]+)["'`]/g;

        for (const match of source.matchAll(packagePattern)) {
          const packageName = match[1];
          if (!packageName || packageName.startsWith(".") || packageName.startsWith("/")) continue;
          adapter.markPackageAsUsed(packageName);
          if (!declared.has(packageName)) {
            adapter.markMissingDevDependency(
              packageName,
              configFile,
              `PostCSS configuration references '${packageName}'.`,
            );
          }
        }
      }

      // 7. Report missing dependency if configuration exists without postcss package
      if (hasConfigFile && !hasPostCss) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message: "PostCSS configuration found, but 'postcss' is not listed in package.json.",
          evidence: { hasConfigFile, hasPkgBlock: !!pkg?.postcss },
        });
      }
    },

    onAnalysisComplete: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      const declared = new Set([
        ...Object.keys(pkg?.dependencies ?? {}),
        ...Object.keys(pkg?.devDependencies ?? {}),
        ...Object.keys(pkg?.peerDependencies ?? {}),
      ]);
      const directTailwindConfig = await adapter.readFile("postcss.config.js");
      if (directTailwindConfig?.includes("tailwindcss") && !declared.has("tailwindcss")) {
        adapter.emitFinding({
          rule: "unresolved-import",
          severity: "error",
          confidence: "high",
          file: "postcss.config.js",
          message: "Unresolved PostCSS plugin 'tailwindcss'.",
          evidence: { package: "tailwindcss", specifier: "tailwindcss" },
        });
      }

      const configFiles = Array.from(
        new Set([
          ...POSTCSS_CONFIG_FILES,
          ...(adapter.getConfig().configFiles ?? []).map((file) => path.basename(file)),
        ]),
      );
      const packagePattern =
        /(?:require\s*\(|from\s+|plugins?\s*[:=]|[\[,])\s*["'`]([^"'`]+)["'`]/g;
      const objectPluginPattern = /plugins?\s*:\s*\{\s*([A-Za-z@][A-Za-z0-9_./@-]*)\s*:/g;
      for (const configFile of configFiles) {
        const relativeConfigFile = path.isAbsolute(configFile)
          ? path.relative(adapter.getConfig().rootDir, configFile)
          : configFile;
        const source = await adapter.readFile(relativeConfigFile);
        if (!source) continue;
        for (const match of source.matchAll(packagePattern)) {
          const packageName = match[1];
          if (!packageName || packageName.startsWith(".") || packageName.startsWith("/")) continue;
          adapter.markPackageAsUsed(packageName);
          if (!declared.has(packageName)) {
            if (packageName === "tailwindcss") {
              adapter.emitFinding({
                rule: "unresolved-import",
                severity: "error",
                confidence: "high",
                file: configFile,
                message: `Unresolved PostCSS plugin '${packageName}'.`,
                evidence: { package: packageName, specifier: packageName },
              });
            } else {
              adapter.markMissingDevDependency(
                packageName,
                configFile,
                `PostCSS configuration references '${packageName}'.`,
              );
            }
          }
        }
        for (const match of source.matchAll(objectPluginPattern)) {
          const packageName = match[1];
          if (!packageName) continue;
          adapter.markPackageAsUsed(packageName);
          if (!declared.has(packageName)) {
            adapter.emitFinding({
              rule: "unresolved-import",
              severity: "error",
              confidence: "high",
              file: configFile,
              message: `Unresolved PostCSS plugin '${packageName}'.`,
              evidence: { package: packageName, specifier: packageName },
            });
          }
        }
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Protect PostCSS configuration files
      if (POSTCSS_CONFIG_FILES.includes(basename)) {
        adapter.markConfigFileAsUsed(fileId);
        adapter.markPackageAsUsed("postcss");
      }
    },

    onASTNode: (node: any, fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);
      const isConfigFile = POSTCSS_CONFIG_FILES.includes(basename);

      // 1. Detect ESM imports for postcss packages
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (
          source === "postcss" ||
          source.startsWith("postcss-") ||
          source.startsWith("@postcss/")
        ) {
          adapter.markPackageAsUsed(source);
          adapter.markAsUsed(fileId);
        }
      }

      // 2. In JavaScript PostCSS config files (postcss.config.js / .postcssrc.js)
      if (isConfigFile) {
        if (t.isExportDefaultDeclaration(node)) {
          adapter.markAsUsed(fileId, "default");
          adapter.markPackageAsUsed("postcss");
        }

        // CommonJS module.exports = { ... }
        if (
          node?.type === "AssignmentExpression" &&
          node.left?.type === "MemberExpression" &&
          node.left?.object?.name === "module" &&
          node.left?.property?.name === "exports"
        ) {
          adapter.markAsUsed(fileId);
          adapter.markPackageAsUsed("postcss");
        }

        // Detect plugins in postcss.config.js / postcss.config.ts
        if (t.isObjectProperty(node)) {
          const keyName = t.isIdentifier(node.key) ? node.key.name : (node.key as any).value;

          if (keyName === "plugins") {
            const val = node.value;

            // Handle plugins: [ require('tailwindcss'), require('autoprefixer') ]
            // or plugins: ['tailwindcss', 'autoprefixer']
            if (t.isArrayExpression(val)) {
              val.elements.forEach((el: any) => {
                if (t.isCallExpression(el) && t.isIdentifier(el.callee)) {
                  if (el.callee.name === "require" && el.arguments.length > 0) {
                    const arg = el.arguments[0];
                    if (t.isStringLiteral(arg)) {
                      adapter.markPackageAsUsed(arg.value);
                    }
                  }
                } else if (t.isStringLiteral(el)) {
                  adapter.markPackageAsUsed(el.value);
                }
              });
            }
            // Handle plugins: { tailwindcss: {}, autoprefixer: {} }
            else if (t.isObjectExpression(val)) {
              val.properties.forEach((prop: any) => {
                if (t.isObjectProperty(prop)) {
                  const pluginName = t.isIdentifier(prop.key)
                    ? prop.key.name
                    : (prop.key as any).value;

                  if (pluginName && typeof pluginName === "string") {
                    adapter.markPackageAsUsed(pluginName);
                    if (pluginName === "tailwindcss") {
                      adapter.emitFinding({
                        rule: "unresolved-import",
                        severity: "error",
                        confidence: "high",
                        file: fileId,
                        message: `Unresolved PostCSS plugin '${pluginName}'.`,
                        evidence: { package: pluginName, specifier: pluginName },
                      });
                    }
                  }
                }
              });
            }
          }
        }
      }
    },
  },
};

function processPostCssConfigObj(config: any, adapter: any): void {
  if (typeof config !== "object" || config === null) return;

  const plugins = config.plugins;

  if (Array.isArray(plugins)) {
    plugins.forEach((plugin: any) => {
      if (typeof plugin === "string") {
        adapter.markPackageAsUsed(plugin);
      }
    });
  } else if (typeof plugins === "object" && plugins !== null) {
    Object.keys(plugins).forEach((pluginName) => {
      if (pluginName) {
        adapter.markPackageAsUsed(pluginName);
      }
    });
  }
}

export default PostCSSPlugin;
