import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

/**
 * Recognized oclif runtime and manifest files
 */
const OCLIF_ENTRY_FILES = [
  "bin/run.js",
  "bin/run.ts",
  "bin/run.cjs",
  "bin/run.mjs",
  "bin/dev.js",
  "bin/dev.ts",
  "bin/dev.cjs",
  "bin/dev.mjs",
  "oclif.manifest.json",
];

const OCLIF_CORE_PACKAGES = [
  "@oclif/core",
  "@oclif/test",
  "@oclif/plugin-help",
  "@oclif/plugin-plugins",
  "@oclif/plugin-commands",
  "@oclif/plugin-autocomplete",
  "@oclif/plugin-warn-if-update-available",
  "@oclif/plugin-version",
];

/**
 * Helper to process inline package.json#oclif manifest object and retain plugins
 */
function processOclifManifest(oclifConfig: Record<string, any>, adapter: any): void {
  if (!oclifConfig || typeof oclifConfig !== "object") return;

  // Process plugins array declared in package.json#oclif.plugins
  if (Array.isArray(oclifConfig.plugins)) {
    for (const plugin of oclifConfig.plugins) {
      if (typeof plugin === "string") {
        adapter.markPackageAsUsed(plugin);
      }
    }
  }

  // Process devPlugins array
  if (Array.isArray(oclifConfig.devPlugins)) {
    for (const plugin of oclifConfig.devPlugins) {
      if (typeof plugin === "string") {
        adapter.markPackageAsUsed(plugin);
      }
    }
  }
}

export const OclifPlugin: AnalyzerPlugin = {
  name: "oclif-plugin",
  version: "1.0.0",

  detect: async (adapter) => {
    // 1. Check for dedicated oclif directories or entry files
    if ((await adapter.folderExists("src/commands")) || (await adapter.folderExists("src/hooks"))) {
      return true;
    }

    for (const entryFile of OCLIF_ENTRY_FILES) {
      if (await adapter.folderExists(entryFile)) return true;
    }

    // 2. Check package.json for inline config or @oclif/* dependencies
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      if (pkg.oclif) return true;

      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies,
      };

      if (Object.keys(allDeps).some((dep) => dep.startsWith("@oclif/"))) {
        return true;
      }
    }

    return false;
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");

      // 1. Protect dedicated oclif bin runners and manifests
      for (const entryFile of OCLIF_ENTRY_FILES) {
        if (await adapter.folderExists(entryFile)) {
          adapter.markAsUsed(entryFile);
        }
      }

      // 2. Protect commands and hooks folders
      if (await adapter.folderExists("src/commands")) {
        adapter.markAsUsed("src/commands");
      }
      if (await adapter.folderExists("src/hooks")) {
        adapter.markAsUsed("src/hooks");
      }

      if (pkg) {
        // 3. Protect all @oclif/* packages in package.json
        const allDeps = {
          ...pkg.dependencies,
          ...pkg.devDependencies,
          ...pkg.peerDependencies,
        };

        for (const depName of Object.keys(allDeps)) {
          if (depName.startsWith("@oclif/")) {
            // A manifest entry alone is not evidence that this package is used.
            // Usage is marked by the config, script, import, or file hooks below.
          }
        }

        // 4. Process inline package.json#oclif configuration block
        if (pkg.oclif) {
          adapter.markAsUsed("package.json", "oclif");
          processOclifManifest(pkg.oclif, adapter);
        }

        // 5. Mark npm scripts executing oclif CLI commands
        if (pkg.scripts) {
          for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
            if (
              typeof scriptContent === "string" &&
              (/\boclif\b/.test(scriptContent) || scriptContent.includes("oclif-dev"))
            ) {
              adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            }
          }
        }
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");

      // Protect bin executables (bin/run.js, bin/dev.js)
      if (
        normalized.startsWith("bin/run.") ||
        normalized.startsWith("bin/dev.") ||
        normalized.includes("/bin/run.") ||
        normalized.includes("/bin/dev.") ||
        normalized === "oclif.manifest.json"
      ) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("@oclif/core");
      }

      // Protect command and hook source files (src/commands/**, src/hooks/**)
      if (
        normalized.includes("/src/commands/") ||
        normalized.startsWith("src/commands/") ||
        normalized.includes("/src/hooks/") ||
        normalized.startsWith("src/hooks/")
      ) {
        // Oclif discovers command and hook modules by convention at runtime.
        // File reachability alone is insufficient: their exported handlers are
        // consumed by the framework rather than by static source imports.
        adapter.markAsUsed(fileId, "*");
        adapter.markPackageAsUsed("@oclif/core");
      }
    },

    onASTNode: (node: any, fileId: string, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");

      // 1. Inspect command/hook files extending Command or export default
      if (
        normalized.includes("/src/commands/") ||
        normalized.startsWith("src/commands/") ||
        normalized.includes("/src/hooks/") ||
        normalized.startsWith("src/hooks/")
      ) {
        // Protect export default Command class or hook functions
        if (t.isExportDefaultDeclaration(node) || t.isExportNamedDeclaration(node)) {
          // Protect the complete runtime-facing export surface of Oclif
          // command/hook modules from unused-export false positives.
          adapter.markAsUsed(fileId, "*");
        }

        // Protect static flags / description / args properties on Command classes
        if (t.isClassDeclaration(node)) {
          const superClass = (node as any).superClass;
          if (
            superClass &&
            t.isIdentifier(superClass) &&
            ["Command", "Args", "Flags"].includes(superClass.name)
          ) {
            adapter.markAsUsed(fileId);
            if (node.id) {
              adapter.markAsUsed(fileId, node.id.name);
            }
            adapter.markPackageAsUsed("@oclif/core");
          }
        }
      }

      // 2. Retain imports from @oclif/core or @oclif/*
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (source.startsWith("@oclif/")) {
          adapter.markPackageAsUsed(source);
          adapter.markAsUsed(fileId);
        }
      }
    },
  },
};

export default OclifPlugin;
