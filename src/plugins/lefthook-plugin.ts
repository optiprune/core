import { AnalyzerPlugin } from "../types.js";
import path from "pathe";

const LEFTHOOK_CONFIG_FILES = [
  "lefthook.yml",
  "lefthook.yaml",
  "lefthook.json",
  ".lefthook.yml",
  ".lefthook.yaml",
  ".lefthook.json",
  "lefthook-local.yml",
  "lefthook-local.yaml",
  ".lefthook-local.yml",
  ".lefthook-local.yaml",
];

const LEFTHOOK_PACKAGES = ["lefthook", "@lefthook/lefthook"];

export const LefthookPlugin: AnalyzerPlugin = {
  name: "lefthook-plugin",
  version: "1.2.0",

  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (LEFTHOOK_PACKAGES.some((pkgName) => pkgName in allDeps)) {
        return true;
      }
    }

    for (const configFile of LEFTHOOK_CONFIG_FILES) {
      if (await adapter.folderExists(configFile)) return true;
    }

    return await adapter.folderExists(".lefthook");
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      const allDeps = {
        ...pkg?.dependencies,
        ...pkg?.devDependencies,
        ...pkg?.peerDependencies,
      };

      const hasLefthookDep = LEFTHOOK_PACKAGES.some((p) => p in allDeps);

      let hasConfigFile = false;
      for (const configFile of LEFTHOOK_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          hasConfigFile = true;
          adapter.markAsUsed(configFile);
        }
      }

      if (await adapter.folderExists(".lefthook")) {
        hasConfigFile = true;
        adapter.markAsUsed(".lefthook");
      }

      // Mark installed Lefthook packages as used in package.json
      // Package manifest presence alone is not usage evidence;
      // config, script, import, and file hooks provide the usage marks.

      // Track npm scripts invoking Lefthook CLI (e.g. "prepare": "lefthook install")
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (
            typeof scriptContent === "string" &&
            (scriptContent.includes("lefthook") || scriptContent.includes("lefthook install"))
          ) {
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
          }
        }
      }

      // Inspect lefthook configuration content to protect referenced tools/scripts
      for (const configFile of LEFTHOOK_CONFIG_FILES) {
        const content = await adapter.readFile(configFile);
        if (!content) continue;

        // Extract CLI commands inside "run:" declarations (e.g., "run: npx eslint {staged_files}")
        const runMatches = content.matchAll(/run:\s*["']?([^"'\n\r]+)["']?/g);
        for (const match of runMatches) {
          const rawCmd = match[1]?.trim();
          if (!rawCmd) continue;

          // Extract script references: npm run <script> / pnpm <script> / yarn <script>
          const scriptMatch = /(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?([a-zA-Z0-9\-_:]+)/i.exec(rawCmd);
          if (scriptMatch?.[1] && !["run", "exec", "dlx"].includes(scriptMatch[1])) {
            adapter.markAsUsed("package.json", `scripts:${scriptMatch[1]}`);
          }

          // Extract CLI tool references: npx <tool> / pnpm dlx <tool> / direct CLI call
          const cliMatch = /(?:npx|bunx|pnpm\s+dlx|yarn\s+dlx)\s+([@a-zA-Z0-9\-\/]+)/i.exec(rawCmd);
          if (cliMatch?.[1] && !cliMatch[1].startsWith("-")) {
            adapter.markPackageAsUsed(cliMatch[1]);
          } else {
            // Direct tool invocation (e.g., "run: eslint {staged_files}")
            const firstToken = rawCmd.split(/\s+/)[0];
            if (
              firstToken &&
              !firstToken.startsWith(".") &&
              !firstToken.startsWith("/") &&
              !firstToken.startsWith("-")
            ) {
              adapter.markPackageAsUsed(firstToken);
            }
          }
        }
      }

      if (hasConfigFile && !hasLefthookDep) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message: "Lefthook configuration found but 'lefthook' is not listed in package.json.",
          evidence: { hasConfigFile },
        });
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      if (LEFTHOOK_CONFIG_FILES.includes(basename) || normalized.includes(".lefthook/")) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("lefthook");
      }
    },
  },
};

export default LefthookPlugin;
