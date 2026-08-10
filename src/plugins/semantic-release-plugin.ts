import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const SEMANTIC_RELEASE_CONFIG_FILES = [
  ".releaserc",
  ".releaserc.json",
  ".releaserc.yaml",
  ".releaserc.yml",
  ".releaserc.js",
  ".releaserc.cjs",
  ".releaserc.mjs",
  "release.config.js",
  "release.config.cjs",
  "release.config.mjs",
  "release.config.ts"
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

export const SemanticReleasePlugin: AnalyzerPlugin = {
  name: "semantic-release-plugin",
  version: "1.0.0",

  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies
      };

      if (
        Object.keys(allDeps).some(
          (dep) =>
            dep === "semantic-release" ||
            dep.startsWith("@semantic-release/") ||
            dep.startsWith("semantic-release-")
        ) ||
        pkg.release
      ) {
        return true;
      }

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (
          scriptValues.some(
            (s) =>
              typeof s === "string" &&
              (s.includes("semantic-release") || s.includes("npx semantic-release"))
          )
        ) {
          return true;
        }
      }
    }

    for (const configFile of SEMANTIC_RELEASE_CONFIG_FILES) {
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

      const hasSemanticRelease = Object.keys(allDeps).some(
        (p) =>
          p === "semantic-release" ||
          p.startsWith("@semantic-release/") ||
          p.startsWith("semantic-release-")
      );

      // 1. Safeguard all installed semantic-release packages and plugins in package.json
      if (hasSemanticRelease) {
        for (const depName of Object.keys(allDeps)) {
          if (
            depName === "semantic-release" ||
            depName.startsWith("@semantic-release/") ||
            depName.startsWith("semantic-release-")
          ) {
            adapter.markPackageAsUsed(depName);
          }
        }
      }

      // 2. Protect standalone configuration files
      let hasConfigFile = false;
      for (const configFile of SEMANTIC_RELEASE_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          hasConfigFile = true;
          adapter.markAsUsed(configFile);
        }
      }

      // 3. Process package.json "release" block if present
      let releaseConfig: any = null;
      if (pkg?.release) {
        hasConfigFile = true;
        adapter.markAsUsed("package.json", "release");
        releaseConfig = pkg.release;
      }

      // 4. Track npm scripts invoking semantic-release CLI
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (
            typeof scriptContent === "string" &&
            scriptContent.includes("semantic-release")
          ) {
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            adapter.markPackageAsUsed("semantic-release");
          }
        }
      }

      // 5. Inspect JSON configuration files (.releaserc, .releaserc.json) for plugins
      if (!releaseConfig) {
        for (const jsonConfigName of [".releaserc", ".releaserc.json"]) {
          const content = await adapter.readFile(jsonConfigName);
          if (content) {
            const parsed = parseJsonc(content);
            if (parsed) {
              releaseConfig = parsed;
              break;
            }
          }
        }
      }

      // 6. Extract declared plugins from config object
      if (releaseConfig) {
        processReleaseConfigObj(releaseConfig, adapter);
      }

      // 7. Report missing dependency if configuration exists without semantic-release package
      if (hasConfigFile && !hasSemanticRelease) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message:
            "semantic-release configuration found, but 'semantic-release' is not listed in package.json.",
          evidence: { hasConfigFile, hasPkgBlock: !!pkg?.release }
        });
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Protect configuration files
      if (SEMANTIC_RELEASE_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("semantic-release");
      }
    },

    onASTNode: (node: any, fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);
      const isConfigFile = SEMANTIC_RELEASE_CONFIG_FILES.includes(basename);

      // 1. Detect ESM imports for semantic-release plugins
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (
          source === "semantic-release" ||
          source.startsWith("@semantic-release/") ||
          source.startsWith("semantic-release-")
        ) {
          adapter.markPackageAsUsed(source);
          adapter.markAsUsed(fileId);
        }
      }

      // 2. In JS configuration files (release.config.js / .releaserc.js)
      if (isConfigFile) {
        if (t.isExportDefaultDeclaration(node)) {
          adapter.markAsUsed(fileId, "default");
          adapter.markPackageAsUsed("semantic-release");
        }

        // CommonJS module.exports = { ... }
        if (
          node?.type === "AssignmentExpression" &&
          node.left?.type === "MemberExpression" &&
          node.left?.object?.name === "module" &&
          node.left?.property?.name === "exports"
        ) {
          adapter.markAsUsed(fileId);
          adapter.markPackageAsUsed("semantic-release");
        }

        // Search for plugins in JS configuration objects
        if (t.isObjectProperty(node)) {
          const keyName = t.isIdentifier(node.key)
            ? node.key.name
            : (node.key as any).value;

          if (keyName === "plugins" && t.isArrayExpression(node.value)) {
            node.value.elements.forEach((el: any) => {
              // Simple string plugin: "@semantic-release/git"
              if (t.isStringLiteral(el)) {
                adapter.markPackageAsUsed(el.value);
              }
              // Configured plugin tuple: ["@semantic-release/git", { assets: [...] }]
              else if (t.isArrayExpression(el) && el.elements.length > 0) {
                const pluginNameNode = el.elements[0];
                if (t.isStringLiteral(pluginNameNode)) {
                  adapter.markPackageAsUsed(pluginNameNode.value);
                }
              }
            });
          }
        }
      }
    }
  }
};

function processReleaseConfigObj(config: any, adapter: any): void {
  if (typeof config !== "object" || config === null) return;

  if (Array.isArray(config.plugins)) {
    config.plugins.forEach((pluginEntry: any) => {
      let pluginName: string | null = null;

      if (typeof pluginEntry === "string") {
        pluginName = pluginEntry;
      } else if (
        Array.isArray(pluginEntry) &&
        typeof pluginEntry[0] === "string"
      ) {
        pluginName = pluginEntry[0];
      }

      if (pluginName) {
        adapter.markPackageAsUsed(pluginName);
      }
    });
  }
}

export default SemanticReleasePlugin;