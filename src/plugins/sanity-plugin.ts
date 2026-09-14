import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

/**
 * Recognized Sanity Studio and CLI configuration files
 */
const SANITY_CONFIG_FILES = [
  "sanity.config.ts",
  "sanity.config.js",
  "sanity.config.tsx",
  "sanity.config.jsx",
  "sanity.cli.ts",
  "sanity.cli.js",
  "sanity.json",
];

const SANITY_CORE_PACKAGES = [
  "sanity",
  "@sanity/cli",
  "@sanity/client",
  "@sanity/vision",
  "@sanity/icons",
  "@sanity/image-url",
  "@sanity/asset-utils",
  "@sanity/block-tools",
  "@sanity/types",
  "next-sanity",
];

/**
 * Helper to process Sanity configuration objects
 */
function processSanityConfig(config: Record<string, any>, adapter: any): void {
  if (!config || typeof config !== "object") return;

  // Process plugins array declared in legacy sanity.json or config objects
  if (config.plugins && Array.isArray(config.plugins)) {
    for (const plugin of config.plugins) {
      if (typeof plugin === "string") {
        const pkgName = plugin.startsWith("sanity-plugin-") ? plugin : `sanity-plugin-${plugin}`;
        adapter.markPackageAsUsed(pkgName);
      }
    }
  }
}

export const SanityPlugin: AnalyzerPlugin = {
  name: "sanity-plugin",
  version: "1.0.0",

  detect: async (adapter) => {
    // 1. Check for dedicated Sanity configuration files
    for (const configFile of SANITY_CONFIG_FILES) {
      if (await adapter.folderExists(configFile)) return true;
    }

    // 2. Check for Sanity schema folders
    if ((await adapter.folderExists("schemaTypes")) || (await adapter.folderExists("schemas"))) {
      return true;
    }

    // 3. Check package.json for Sanity dependencies or CLI scripts
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
            dep === "sanity" ||
            dep.startsWith("@sanity/") ||
            dep.startsWith("sanity-plugin-") ||
            dep === "next-sanity",
        )
      ) {
        return true;
      }

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (
          scriptValues.some(
            (s) => typeof s === "string" && (/\bsanity\b/.test(s) || s.includes("sanity dev")),
          )
        ) {
          return true;
        }
      }
    }

    return false;
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");

      // 1. Protect dedicated Sanity configuration files
      for (const configFile of SANITY_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          adapter.markAsUsed(configFile);
        }
      }

      // 2. Protect schema definition folders (schemaTypes/ or schemas/)
      if (await adapter.folderExists("schemaTypes")) {
        adapter.markAsUsed("schemaTypes");
      }
      if (await adapter.folderExists("schemas")) {
        adapter.markAsUsed("schemas");
      }

      if (pkg) {
        // 3. Protect all sanity, @sanity/*, and sanity-plugin-* packages in package.json
        const allDeps = {
          ...pkg.dependencies,
          ...pkg.devDependencies,
          ...pkg.peerDependencies,
        };

        for (const depName of Object.keys(allDeps)) {
          if (
            depName === "sanity" ||
            depName === "next-sanity" ||
            depName.startsWith("@sanity/") ||
            depName.startsWith("sanity-plugin-")
          ) {
            // A manifest entry alone is not evidence that this package is used.
            // Usage is marked by the config, script, import, or file hooks below.
          }
        }

        // 4. Mark scripts executing sanity CLI as used
        if (pkg.scripts) {
          for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
            if (
              typeof scriptContent === "string" &&
              (/\bsanity\b/.test(scriptContent) || scriptContent.includes("sanity dev"))
            ) {
              adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            }
          }
        }
      }

      // 5. Parse legacy sanity.json if present
      if (await adapter.folderExists("sanity.json")) {
        const configData = await adapter.readJson("sanity.json");
        if (configData) {
          processSanityConfig(configData, adapter);
        }
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Protect configuration files
      if (SANITY_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
      }

      // Protect schema definition files
      if (
        normalized.includes("/schemaTypes/") ||
        normalized.startsWith("schemaTypes/") ||
        normalized.includes("/schemas/") ||
        normalized.startsWith("schemas/")
      ) {
        adapter.markAsUsed(fileId);
      }
    },

    onASTNode: (node: any, fileId: string, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // 1. Inspect JS/TS config files (sanity.config.ts, sanity.cli.ts, etc.)
      if (basename.startsWith("sanity.config.") || basename.startsWith("sanity.cli.")) {
        if (t.isExportDefaultDeclaration(node)) {
          adapter.markAsUsed(fileId, "default");
        }

        if (
          t.isAssignmentExpression(node) &&
          t.isMemberExpression(node.left) &&
          t.isIdentifier(node.left.object) &&
          node.left.object.name === "module" &&
          t.isIdentifier(node.left.property) &&
          node.left.property.name === "exports"
        ) {
          adapter.markAsUsed(fileId);
        }

        // AST Property Inspection for "plugins" inside defineConfig({ plugins: [...] })
        if (
          t.isObjectProperty(node) &&
          t.isIdentifier(node.key) &&
          node.key.name === "plugins" &&
          t.isArrayExpression(node.value)
        ) {
          for (const el of node.value.elements) {
            // Function call plugins: structureTool(), visionTool()
            if (t.isCallExpression(el) && t.isIdentifier(el.callee)) {
              adapter.markAsUsed(fileId);
            }
          }
        }
      }

      // 2. Protect exports inside schema files (e.g. export default defineType({...}))
      if (normalized.includes("/schemaTypes/") || normalized.includes("/schemas/")) {
        if (t.isExportDefaultDeclaration(node)) {
          adapter.markAsUsed(fileId, "default");
        }
        if (t.isExportNamedDeclaration(node) && node.declaration) {
          if (t.isVariableDeclaration(node.declaration)) {
            for (const decl of node.declaration.declarations) {
              if (t.isVariableDeclarator(decl) && t.isIdentifier(decl.id)) {
                adapter.markAsUsed(fileId, decl.id.name);
              }
            }
          }
        }
      }

      // 3. Retain imports from sanity or @sanity/* or next-sanity
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (
          source === "sanity" ||
          source === "next-sanity" ||
          source.startsWith("@sanity/") ||
          source.startsWith("sanity-plugin-")
        ) {
          adapter.markPackageAsUsed(source);
          adapter.markAsUsed(fileId);
        }
      }
    },
  },
};

export default SanityPlugin;
