import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

/**
 * Recognized Tauri configuration and rust files
 */
const TAURI_CONFIG_FILES = [
  "src-tauri/tauri.conf.json",
  "src-tauri/tauri.conf.json5",
  "tauri.conf.json",
  "tauri.conf.json5",
  "src-tauri/Cargo.toml",
  "src-tauri/build.rs",
];

const TAURI_CORE_PACKAGES = ["@tauri-apps/cli", "@tauri-apps/api"];

/**
 * Helper to process tauri.conf.json configuration properties
 */
function processTauriConfig(config: Record<string, any>, adapter: any): void {
  if (!config || typeof config !== "object") return;

  const build = config.build;
  if (build && typeof build === "object") {
    // Tauri v1: distDir, Tauri v2: frontendDist
    const distDir = build.frontendDist || build.distDir;
    if (typeof distDir === "string" && !distDir.includes("*")) {
      adapter.markAsUsed(distDir);
    }

    // Protect devUrl / beforeDevCommand references if local
    if (typeof build.beforeDevCommand === "string") {
      adapter.markAsUsed("tauri.conf.json", "build:beforeDevCommand");
    }
    if (typeof build.beforeBuildCommand === "string") {
      adapter.markAsUsed("tauri.conf.json", "build:beforeBuildCommand");
    }
  }
}

export const TauriPlugin: AnalyzerPlugin = {
  name: "tauri-plugin",
  version: "1.0.0",

  detect: async (adapter) => {
    // 1. Check for src-tauri folder or tauri configuration files
    if (await adapter.folderExists("src-tauri")) return true;

    for (const configFile of TAURI_CONFIG_FILES) {
      if (await adapter.folderExists(configFile)) return true;
    }

    // 2. Check package.json for @tauri-apps/* dependencies or tauri CLI scripts
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      if (pkg.tauri) return true;

      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies,
      };

      if (Object.keys(allDeps).some((dep) => dep === "tauri" || dep.startsWith("@tauri-apps/"))) {
        return true;
      }

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (
          scriptValues.some(
            (s) => typeof s === "string" && (/\btauri\b/.test(s) || s.includes("tauri dev")),
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

      // 1. Protect src-tauri directory and config files
      if (await adapter.folderExists("src-tauri")) {
        adapter.markAsUsed("src-tauri");
      }

      for (const configFile of TAURI_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          adapter.markAsUsed(configFile);
        }
      }

      if (pkg) {
        // 2. Protect all @tauri-apps/* packages in package.json dependencies
        const allDeps = {
          ...pkg.dependencies,
          ...pkg.devDependencies,
          ...pkg.peerDependencies,
        };

        for (const depName of Object.keys(allDeps)) {
          if (depName.startsWith("@tauri-apps/") || depName === "tauri") {
            // A manifest entry alone is not evidence that this package is used.
            // Usage is marked by the config, script, import, or file hooks below.
          }
        }

        // 3. Mark scripts executing tauri CLI as used
        if (pkg.scripts) {
          for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
            if (
              typeof scriptContent === "string" &&
              (/\btauri\b/.test(scriptContent) || scriptContent.includes("tauri dev"))
            ) {
              adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            }
          }
        }
      }

      // 4. Parse tauri.conf.json if present
      const tauriConfigPath = (await adapter.folderExists("src-tauri/tauri.conf.json"))
        ? "src-tauri/tauri.conf.json"
        : (await adapter.folderExists("tauri.conf.json"))
          ? "tauri.conf.json"
          : null;

      if (tauriConfigPath) {
        const configData = await adapter.readJson(tauriConfigPath);
        if (configData) {
          processTauriConfig(configData, adapter);
        }
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Protect src-tauri folder files (Rust code, icons, Cargo.toml)
      if (normalized.includes("/src-tauri/") || normalized.startsWith("src-tauri/")) {
        adapter.markAsUsed(fileId);
      }

      // Protect configuration files
      if (TAURI_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
      }
    },

    onASTNode: (node: any, fileId: string, adapter) => {
      // Retain imports from @tauri-apps/* in JavaScript / TypeScript code
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (source.startsWith("@tauri-apps/")) {
          adapter.markPackageAsUsed(source);
          adapter.markAsUsed(fileId);
        }
      }
    },
  },
};

export default TauriPlugin;
