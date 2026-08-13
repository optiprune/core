import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const RAYCAST_PACKAGES = [
  "@raycast/api",
  "@raycast/utils"
];

const RAYCAST_CONFIG_FILES = [
  "raycast.config.json"
];

export const RaycastPlugin: AnalyzerPlugin = {
  name: "raycast-plugin",
  version: "1.0.0",

  detect: async (adapter) => {
    // 1. Check package.json dependencies, raycast field, or scripts
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies
      };

      if (
        Object.keys(allDeps).some((dep) => RAYCAST_PACKAGES.includes(dep)) ||
        pkg.categories ||
        pkg.commands
      ) {
        return true;
      }

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (
          scriptValues.some(
            (s) =>
              typeof s === "string" && (s.includes("raycast ") || s === "raycast")
          )
        ) {
          return true;
        }
      }
    }

    // 2. Check for Raycast configuration file
    for (const configFile of RAYCAST_CONFIG_FILES) {
      if (await adapter.folderExists(configFile)) return true;
    }

    // 3. Check for default assets directory
    return await adapter.folderExists("assets");
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      const allDeps = {
        ...pkg?.dependencies,
        ...pkg?.devDependencies,
        ...pkg?.peerDependencies
      };

      const hasRaycastApi = "@raycast/api" in allDeps;

      // 1. Safeguard Raycast ecosystem packages in package.json
      // Package declaration alone is not usage evidence.

      // 2. Protect standalone configuration files
      let hasConfigFile = false;
      for (const configFile of RAYCAST_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          hasConfigFile = true;
          adapter.markAsUsed(configFile);
        }
      }

      // 3. Protect Extension assets directory (extension icons, screenshots)
      if (await adapter.folderExists("assets")) {
        adapter.markAsUsed("assets");
      }

      // 4. Inspect package.json "commands" array for command entry points and icons
      if (Array.isArray(pkg?.commands)) {
        hasConfigFile = true;
        adapter.markAsUsed("package.json", "commands");

        pkg.commands.forEach((cmd: any) => {
          if (typeof cmd === "object" && cmd !== null) {
            // Protect command source file entry point (e.g. "mode": "view", "name": "index") -> src/index.tsx
            if (typeof cmd.name === "string") {
              const possibleEntries = [
                `src/${cmd.name}.tsx`,
                `src/${cmd.name}.ts`,
                `src/${cmd.name}.jsx`,
                `src/${cmd.name}.js`
              ];

              for (const entry of possibleEntries) {
                adapter.markAsUsed(entry);
              }
            }

            // Protect command icon references (e.g. "icon": "command-icon.png")
            if (typeof cmd.icon === "string") {
              if (cmd.icon.startsWith("assets/") || cmd.icon.startsWith("./assets/")) {
                adapter.markAsUsed(cmd.icon);
              } else {
                adapter.markAsUsed(`assets/${cmd.icon}`);
              }
            }
          }
        });
      }

      // 5. Track extension categories field in package.json
      if (pkg?.categories) {
        adapter.markAsUsed("package.json", "categories");
      }

      // 6. Track npm scripts invoking Raycast CLI (e.g., "build": "raycast build -e dist")
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (
            typeof scriptContent === "string" &&
            (scriptContent.includes("raycast ") || scriptContent === "raycast")
          ) {
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            adapter.markPackageAsUsed("@raycast/api");
          }
        }
      }

      // 7. Report missing dependency if Raycast commands exist without @raycast/api
      if ((hasConfigFile || pkg?.commands) && !hasRaycastApi) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message:
            "Raycast Extension configuration or commands found, but '@raycast/api' is not listed in package.json.",
          evidence: { hasConfigFile, hasCommands: !!pkg?.commands }
        });
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Protect Raycast configuration files
      if (RAYCAST_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("@raycast/api");
      }

      // Protect asset files inside assets/
      if (
        normalized.includes("/assets/") ||
        normalized.startsWith("assets/")
      ) {
        adapter.markAsUsed(fileId);
      }
    },

    onASTNode: (node: any, fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");

      // 1. Detect ESM imports for @raycast/api or @raycast/utils
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (source === "@raycast/api" || source.startsWith("@raycast/")) {
          adapter.markPackageAsUsed(source);
          adapter.markAsUsed(fileId);
        }
      }

      // 2. Protect Raycast Command View default exports (e.g., export default function Command() { return <List /> })
      if (t.isExportDefaultDeclaration(node)) {
        adapter.markAsUsed(fileId, "default");
      }
    }
  }
};

export default RaycastPlugin;