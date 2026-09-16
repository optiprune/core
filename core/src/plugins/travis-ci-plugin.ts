import { AnalyzerPlugin } from "../types.js";
import path from "pathe";

const TRAVIS_CONFIG_FILES = [".travis.yml", ".travis.yaml"];

const TRAVIS_LIFECYCLE_HOOKS = [
  "before_install",
  "install",
  "before_script",
  "script",
  "after_success",
  "after_failure",
  "before_deploy",
  "deploy",
  "after_deploy",
  "after_script",
];

export const TravisCiPlugin: AnalyzerPlugin = {
  name: "travis-ci-plugin",
  version: "1.2.0",

  detect: async (adapter) => {
    // 1. Check for Travis CI configuration files
    for (const configFile of TRAVIS_CONFIG_FILES) {
      if (await adapter.folderExists(configFile)) return true;
    }

    // 2. Check package.json scripts for travis CLI invocations
    const pkg = await adapter.readJson("package.json");
    if (pkg?.scripts) {
      const scriptValues = Object.values(pkg.scripts);
      if (
        scriptValues.some((s) => typeof s === "string" && (s.includes("travis ") || s === "travis"))
      ) {
        return true;
      }
    }

    return false;
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      // 1. Protect standalone configuration files
      for (const configFile of TRAVIS_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          adapter.markAsUsed(configFile);
        }
      }

      // 2. Track npm scripts invoking Travis CLI commands
      const pkg = await adapter.readJson("package.json");
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (
            typeof scriptContent === "string" &&
            (scriptContent.includes("travis ") || scriptContent === "travis")
          ) {
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
          }
        }
      }

      // 3. Inspect .travis.yml for npm scripts or npx tools executed during CI steps
      for (const configFile of TRAVIS_CONFIG_FILES) {
        const configContent = await adapter.readFile(configFile);
        if (configContent) {
          parseTravisYamlCommands(configContent, adapter);
          break;
        }
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Protect Travis CI configuration files
      if (TRAVIS_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
      }
    },
  },
};

function parseTravisYamlCommands(yamlContent: string, adapter: any): void {
  const lines = yamlContent.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();

    // Detect npx invocations: npx <package> or npx --no-install <package>
    if (trimmed.includes("npx ")) {
      const parts = trimmed.split("npx ")[1]?.trim().split(" ");
      const pkgName = parts?.find((p) => !p.startsWith("-"));
      if (pkgName) {
        adapter.markPackageAsUsed(pkgName);
      }
    }

    // Detect npm run / yarn / pnpm script invocations: npm run test, yarn build, pnpm run lint
    if (
      trimmed.includes("npm run ") ||
      trimmed.includes("yarn ") ||
      trimmed.includes("pnpm ") ||
      trimmed.includes("pnpm run ")
    ) {
      const scriptMatch = trimmed.match(/(?:npm run|yarn|pnpm run|pnpm)\s+([a-zA-Z0-9_:-]+)/);
      if (scriptMatch && scriptMatch[1]) {
        const scriptName = scriptMatch[1];
        // Exclude standard CLI flags/commands
        if (!["test", "build", "install", "run", "add"].includes(scriptName)) {
          adapter.markAsUsed("package.json", `scripts:${scriptName}`);
        } else if (scriptName === "test" || scriptName === "build") {
          adapter.markAsUsed("package.json", `scripts:${scriptName}`);
        }
      }
    }
  }
}

export default TravisCiPlugin;
