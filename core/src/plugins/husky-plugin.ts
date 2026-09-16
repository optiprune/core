import { AnalyzerPlugin } from "../types.js";

const HUSKY_HOOKS = [
  "pre-commit",
  "commit-msg",
  "pre-push",
  "post-checkout",
  "post-merge",
  "pre-rebase",
  "prepare-commit-msg",
  "post-commit",
  "post-rewrite",
  "sendemail-validate",
];

const LEGACY_CONFIGS = [
  ".huskyrc",
  ".huskyrc.json",
  ".huskyrc.js",
  ".huskyrc.yaml",
  ".huskyrc.yml",
  "husky.config.js",
  "husky.config.cjs",
];

export const HuskyPlugin: AnalyzerPlugin = {
  name: "husky-plugin",
  version: "1.3.0",

  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (pkg && (pkg.devDependencies?.["husky"] || pkg.dependencies?.["husky"])) {
      return true;
    }

    if (await adapter.folderExists(".husky")) return true;

    for (const config of LEGACY_CONFIGS) {
      if ((await adapter.readFile(config)) !== null) return true;
    }

    return false;
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      const hasHuskyDir = await adapter.folderExists(".husky");

      // Declaring Husky only enables this plugin; an actual hook directory,
      // legacy config, or script is required before the package is retained.
      if (hasHuskyDir) {
        adapter.markPackageAsUsed("husky");
      }

      // 1. Mark legacy configuration files if present
      for (const configPath of LEGACY_CONFIGS) {
        if (await adapter.folderExists(configPath)) {
          adapter.markAsUsed(configPath);
        }
      }

      // 2. Mark package.json scripts that execute husky (e.g. "prepare": "husky")
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (typeof scriptContent === "string" && scriptContent.includes("husky")) {
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
          }
        }
      }

      // 3. Inspect Git Hook files inside .husky/ to extract referenced tools & scripts
      if (hasHuskyDir) {
        for (const hookName of HUSKY_HOOKS) {
          const hookPath = `.husky/${hookName}`;
          const content = await adapter.readFile(hookPath);

          if (!content) continue;

          adapter.markAsUsed(hookPath);

          // Extract npx / pnpm dlx / yarn dlx / bun x commands (e.g., npx lint-staged, npx commitlint)
          const runnerRegex = /(?:npx|bunx|pnpm\s+dlx|yarn\s+dlx)\s+([@a-zA-Z0-9\-\/]+)/gi;
          let match: RegExpExecArray | null;
          while ((match = runnerRegex.exec(content)) !== null) {
            const pkgName = match[1];
            if (pkgName && !pkgName.startsWith("-")) {
              adapter.markPackageAsUsed(pkgName);
            }
          }

          // Extract npm/pnpm/yarn/bun script executions (e.g. "npm run test", "pnpm lint")
          const scriptRegex = /(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?([a-zA-Z0-9\-_:]+)/gi;
          while ((match = scriptRegex.exec(content)) !== null) {
            const scriptTarget = match[1];
            if (scriptTarget && !["run", "exec", "dlx", "install", "test"].includes(scriptTarget)) {
              adapter.markAsUsed("package.json", `scripts:${scriptTarget}`);
            }
          }
        }
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      if (normalized.includes(".husky/")) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("husky");
      }
    },
  },
};

export default HuskyPlugin;
