import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const DEPENDENCY_CRUISER_CONFIG_FILES = [
  ".dependency-cruiser.js",
  ".dependency-cruiser.cjs",
  ".dependency-cruiser.mjs",
  ".dependency-cruiser.ts",
  ".dependency-cruiser.json",
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

export const DependencyCruiserPlugin: AnalyzerPlugin = {
  name: "dependency-cruiser-plugin",
  version: "1.0.0",

  detect: async (adapter) => {
    // 1. Check package.json dependencies, depcruise field, or scripts
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies,
      };

      if ("dependency-cruiser" in allDeps || pkg.depcruise) {
        return true;
      }

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (
          scriptValues.some(
            (s) =>
              typeof s === "string" &&
              (s.includes("depcruise") || s.includes("dependency-cruiser")),
          )
        ) {
          return true;
        }
      }
    }

    // 2. Check for configuration files
    for (const configFile of DEPENDENCY_CRUISER_CONFIG_FILES) {
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

      const hasDepCruise = "dependency-cruiser" in allDeps;

      // 1. Safeguard dependency-cruiser package in package.json
      if (hasDepCruise) {
        adapter.markPackageAsUsed("dependency-cruiser");
      }

      // 2. Protect standalone configuration files
      let hasConfigFile = false;
      for (const configFile of DEPENDENCY_CRUISER_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          hasConfigFile = true;
          adapter.markAsUsed(configFile);
        }
      }

      // 3. Process package.json "depcruise" block if present
      if (pkg?.depcruise) {
        hasConfigFile = true;
        adapter.markAsUsed("package.json", "depcruise");
      }

      // 4. Track npm scripts invoking depcruise CLI
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (
            typeof scriptContent === "string" &&
            (scriptContent.includes("depcruise") || scriptContent.includes("dependency-cruiser"))
          ) {
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            adapter.markPackageAsUsed("dependency-cruiser");
          }
        }
      }

      // 5. Inspect JSON-based config files (.dependency-cruiser.json)
      for (const jsonConfigName of [".dependency-cruiser.json"]) {
        const content = await adapter.readFile(jsonConfigName);
        if (content) {
          const parsed = parseJsonc(content);
          if (parsed?.options?.webpackConfig?.fileName) {
            adapter.markAsUsed(parsed.options.webpackConfig.fileName);
          }
          if (parsed?.options?.tsConfig?.fileName) {
            adapter.markAsUsed(parsed.options.tsConfig.fileName);
          }
        }
      }

      // 6. Report missing dependency if configuration exists without dependency-cruiser package
      if (hasConfigFile && !hasDepCruise) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message:
            "dependency-cruiser configuration found, but 'dependency-cruiser' is not listed in package.json.",
          evidence: { hasConfigFile, hasPkgBlock: !!pkg?.depcruise },
        });
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Protect dependency-cruiser configuration files
      if (DEPENDENCY_CRUISER_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("dependency-cruiser");
      }
    },

    onASTNode: (node: any, fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);
      const isConfigFile = DEPENDENCY_CRUISER_CONFIG_FILES.includes(basename);

      // 1. Detect ESM imports for dependency-cruiser
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (source === "dependency-cruiser") {
          adapter.markPackageAsUsed(source);
          adapter.markAsUsed(fileId);
        }
      }

      // 2. Inspect JS/TS configuration files (.dependency-cruiser.js / .ts)
      if (isConfigFile) {
        if (t.isExportDefaultDeclaration(node)) {
          adapter.markAsUsed(fileId, "default");
          adapter.markPackageAsUsed("dependency-cruiser");
        }

        // CommonJS module.exports = { ... }
        if (
          node?.type === "AssignmentExpression" &&
          node.left?.type === "MemberExpression" &&
          node.left?.object?.name === "module" &&
          node.left?.property?.name === "exports"
        ) {
          adapter.markAsUsed(fileId);
          adapter.markPackageAsUsed("dependency-cruiser");
        }

        // Parse referenced configuration files like tsConfig or webpackConfig options
        if (t.isObjectProperty(node) && t.isIdentifier(node.key)) {
          if (
            ["tsConfig", "webpackConfig", "babelConfig"].includes(node.key.name) &&
            t.isObjectExpression(node.value)
          ) {
            node.value.properties.forEach((prop: any) => {
              if (
                t.isObjectProperty(prop) &&
                t.isIdentifier(prop.key) &&
                prop.key.name === "fileName" &&
                t.isStringLiteral(prop.value)
              ) {
                adapter.markAsUsed(prop.value.value);
              }
            });
          }
        }
      }
    },
  },
};

export default DependencyCruiserPlugin;
