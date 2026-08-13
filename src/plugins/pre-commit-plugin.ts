import { AnalyzerPlugin } from "../types.js";
import path from "pathe";

const PRE_COMMIT_CONFIG_FILES = [
  ".pre-commit-config.yaml",
  ".pre-commit-config.yml",
  ".pre-commit-hooks.yaml",
  ".pre-commit-hooks.yml"
];

const PRE_COMMIT_PACKAGES = [
  "pre-commit",
  "pre-commit-js"
];

export const PreCommitPlugin: AnalyzerPlugin = {
  name: "pre-commit-plugin",
  version: "1.2.0",

  detect: async (adapter) => {
    // 1. Check for standalone pre-commit configuration files
    for (const configFile of PRE_COMMIT_CONFIG_FILES) {
      if (await adapter.folderExists(configFile)) return true;
    }

    // 2. Check package.json dependencies or scripts for pre-commit references
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies
      };

      if (
        Object.keys(allDeps).some((dep) => PRE_COMMIT_PACKAGES.includes(dep))
      ) {
        return true;
      }

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (
          scriptValues.some(
            (s) =>
              typeof s === "string" &&
              (s.includes("pre-commit ") || s === "pre-commit")
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
      const allDeps = {
        ...pkg?.dependencies,
        ...pkg?.devDependencies,
        ...pkg?.peerDependencies
      };

      // 1. Safeguard pre-commit packages in package.json if installed
      // Package declaration alone is not usage evidence.

      // 2. Protect pre-commit configuration files
      let hasConfigFile = false;
      for (const configFile of PRE_COMMIT_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          hasConfigFile = true;
          adapter.markAsUsed(configFile);
        }
      }

      // 3. Track npm scripts invoking pre-commit CLI
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (
            typeof scriptContent === "string" &&
            (scriptContent.includes("pre-commit ") || scriptContent === "pre-commit")
          ) {
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            adapter.markPackageAsUsed("pre-commit");
          }
        }
      }

      // 4. Inspect .pre-commit-config.yaml for npm/node local hook entries
      const configContent = await adapter.readFile(".pre-commit-config.yaml");
      if (configContent) {
        const lines = configContent.split("\n");
        for (const line of lines) {
          const trimmed = line.trim();
          // Detect entry: npx <package> or entry: npm run <script>
          if (trimmed.startsWith("entry:")) {
            const entryValue = trimmed.replace(/^entry:\s*/, "").replace(/^['"]|['"]$/g, "");
            
            if (entryValue.includes("npx ")) {
              const parts = entryValue.split("npx ")[1]?.split(" ");
              if (parts && parts[0]) {
                adapter.markPackageAsUsed(parts[0]);
              }
            } else if (entryValue.includes("npm run ")) {
              const scriptName = entryValue.split("npm run ")[1]?.split(" ")[0];
              if (scriptName) {
                adapter.markAsUsed("package.json", `scripts:${scriptName}`);
              }
            }
          }
        }
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Protect pre-commit configuration and hook files
      if (PRE_COMMIT_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
      }
    }
  }
};

export default PreCommitPlugin;