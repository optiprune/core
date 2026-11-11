import { AnalyzerPlugin } from "../types.js";
import path from "pathe";
import { packageRoot, tokenizeCommand } from "../plugin-utils.js";

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
  for (const line of yamlContent.split("\n")) {
    const tokens = tokenizeCommand(line.trim());
    const npx = tokens.indexOf("npx");
    if (npx >= 0) {
      let i = npx + 1;
      while (i < tokens.length && (tokens[i]?.startsWith("-") || tokens[i - 1] === "-p")) i++;
      if (tokens[i]) adapter.markPackageAsUsed(packageRoot(tokens[i] ?? ""));
    }
    for (const tool of ["npm", "yarn", "pnpm"]) {
      const index = tokens.indexOf(tool);
      if (index < 0) continue;
      let i = index + 1;
      if (tokens[i] === "run") i++;
      while (i < tokens.length && tokens[i]?.startsWith("-")) i++;
      if (tokens[i] && !["install", "add", "exec", "dlx"].includes(tokens[i] ?? ""))
        adapter.markAsUsed("package.json", `scripts:${tokens[i]}`);
    }
  }
}

export default TravisCiPlugin;
