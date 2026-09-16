import { AnalyzerPlugin } from "../types.js";

const CROSS_ENV_PACKAGES = ["cross-env"];

export const CrossEnvPlugin: AnalyzerPlugin = {
  name: "cross-env-plugin",
  version: "1.0.1",

  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (!pkg) return false;

    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (CROSS_ENV_PACKAGES.some((pkgName) => pkgName in allDeps)) {
      return true;
    }

    // Check if cross-env is invoked inside any npm script
    if (pkg.scripts) {
      return Object.values(pkg.scripts).some(
        (script) => typeof script === "string" && script.includes("cross-env"),
      );
    }

    return false;
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      if (!pkg) return;

      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies,
      };

      const hasCrossEnvDep = CROSS_ENV_PACKAGES.some((p) => p in allDeps);
      let isCrossEnvUsedInScripts = false;

      // Inspect package.json scripts
      if (pkg.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (typeof scriptContent !== "string" || !scriptContent.includes("cross-env")) {
            continue;
          }

          isCrossEnvUsedInScripts = true;

          // 1. Mark the package.json script entry as used
          adapter.markAsUsed("package.json", `scripts:${scriptName}`);

          // 2. Mark cross-env package as used
          adapter.markPackageAsUsed("cross-env");

          // 3. Extract target CLI command executed AFTER environment variables
          // Example: "cross-env NODE_ENV=production FOO=bar vite build" -> target CLI is "vite"
          const tokens = scriptContent.split(/\s+/).filter((t) => t.trim().length > 0);

          const crossEnvIndex = tokens.findIndex((t) => t.includes("cross-env"));
          if (crossEnvIndex !== -1) {
            let commandIndex = crossEnvIndex + 1;

            // Skip environment variable assignments like VAR=value or VAR="value with spaces"
            while (commandIndex < tokens.length && tokens[commandIndex]?.includes("=")) {
              commandIndex++;
            }
            const targetCommand = tokens[commandIndex];
            if (targetCommand && !targetCommand.startsWith("-")) {
              // Mark the underlying CLI tool invoked by cross-env as used
              adapter.markPackageAsUsed(targetCommand);
            }
          }
        }
      }

      // If cross-env is listed in package.json dependencies, safeguard it
      if (hasCrossEnvDep) {
        adapter.markPackageAsUsed("cross-env");
      }

      // Emit finding if cross-env is referenced in scripts but missing from package.json
      if (isCrossEnvUsedInScripts && !hasCrossEnvDep) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message:
            "Scripts in package.json invoke 'cross-env', but 'cross-env' is not listed in dependencies/devDependencies.",
          evidence: { isCrossEnvUsedInScripts },
        });
      }
    },
  },
};

export default CrossEnvPlugin;
