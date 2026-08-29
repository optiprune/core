import { AnalyzerPlugin } from "../types.js";
import path from "pathe";

const COMMON_CLI_BINARIES = [
  "tsc",
  "eslint",
  "prettier",
  "vitest",
  "jest",
  "rimraf",
  "rollup",
  "vite",
  "esbuild",
  "webpack",
  "tsup",
  "swc",
  "babel",
];

export const WireitPlugin: AnalyzerPlugin = {
  name: "wireit-plugin",
  version: "1.0.0",

  detect: async (adapter) => {
    // 1. Check package.json for wireit devDependency or wireit configuration block
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies,
      };

      if ("wireit" in allDeps || pkg.wireit) {
        return true;
      }

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (
          scriptValues.some(
            (s) => typeof s === "string" && (s.includes("wireit ") || s === "wireit"),
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
        ...pkg?.peerDependencies,
      };

      const hasWireitDep = "wireit" in allDeps;

      // 1. Safeguard wireit in package.json
      if (hasWireitDep) {
        adapter.markPackageAsUsed("wireit");
      }

      // 2. Process package.json "wireit" configuration block
      if (pkg?.wireit && typeof pkg.wireit === "object") {
        adapter.markAsUsed("package.json", "wireit");

        for (const [taskName, taskConfig] of Object.entries(pkg.wireit)) {
          // Wireit maps package.json scripts to wireit tasks
          if (pkg.scripts && taskName in pkg.scripts) {
            adapter.markAsUsed("package.json", `scripts:${taskName}`);
          }

          if (typeof taskConfig === "object" && taskConfig !== null) {
            const config = taskConfig as Record<string, any>;

            // Extract task dependencies: dependencies: ["build", "./packages/a:build", ":other"]
            if (Array.isArray(config.dependencies)) {
              config.dependencies.forEach((dep: unknown) => {
                if (typeof dep === "string") {
                  // Local or relative sibling package task reference
                  if (dep.startsWith("./") || dep.startsWith("../")) {
                    const packagePath = dep.split(":")[0];
                    if (packagePath) {
                      adapter.markAsUsed(packagePath);
                    }
                  } else {
                    const cleanTask = dep.replace(/^:/, "");
                    adapter.markAsUsed("package.json", `scripts:${cleanTask}`);
                  }
                } else if (
                  typeof dep === "object" &&
                  dep !== null &&
                  typeof (dep as { script?: unknown }).script === "string"
                ) {
                  adapter.markAsUsed(
                    "package.json",
                    `scripts:${(dep as { script: string }).script}`,
                  );
                }
              });
            }

            // Extract input file globs: files: ["src/**/*.ts", "tsconfig.json"]
            if (Array.isArray(config.files)) {
              config.files.forEach((fileGlob: unknown) => {
                if (typeof fileGlob === "string") {
                  adapter.markAsUsed(fileGlob.replace(/^!/, ""));
                }
              });
            }

            // Extract output build paths: output: ["dist/**", "lib/**"]
            if (Array.isArray(config.output)) {
              config.output.forEach((outputPath: unknown) => {
                if (typeof outputPath === "string") {
                  adapter.markAsUsed(outputPath.replace(/^!/, ""));
                }
              });
            }

            // Inspect underlying shell command for npx/tool references: command: "tsc -b"
            if (typeof config.command === "string") {
              parseWireitCommand(config.command, adapter);
            }
          }
        }
      }

      // 3. Track npm scripts invoking wireit
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (
            typeof scriptContent === "string" &&
            (scriptContent.includes("wireit ") || scriptContent === "wireit")
          ) {
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            adapter.markPackageAsUsed("wireit");
          }
        }
      }

      // 4. Report missing dependency if wireit config exists without wireit package
      if (pkg?.wireit && !hasWireitDep) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message:
            "wireit task configuration found in package.json, but 'wireit' is not listed under devDependencies.",
          evidence: { hasWireitConfig: true },
        });
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      if (basename === "package.json") {
        adapter.markPackageAsUsed("wireit");
      }
    },
  },
};

function parseWireitCommand(commandStr: string, adapter: any): void {
  const trimmed = commandStr.trim();

  // 1. Direct CLI binary execution (e.g. "tsc -b", "vitest run", "eslint .")
  const firstWord = trimmed.split(/\s+/)[0]?.replace(/['"]/g, "");
  if (firstWord && COMMON_CLI_BINARIES.includes(firstWord)) {
    adapter.markPackageAsUsed(firstWord);
  }

  // 2. Extract npx CLI package invocations: "npx tsc" or "npx eslint ."
  if (trimmed.includes("npx ")) {
    const parts = trimmed.split("npx ")[1]?.trim().split(" ");
    const pkgName = parts?.find((p) => !p.startsWith("-"));
    if (pkgName) {
      adapter.markPackageAsUsed(pkgName);
    }
  }

  // 3. Extract npm run / yarn / pnpm script invocations: "npm run lint"
  if (trimmed.includes("npm run ") || trimmed.includes("pnpm run ") || trimmed.includes("yarn ")) {
    const match = trimmed.match(/(?:npm run|pnpm run|yarn)\s+([a-zA-Z0-9_:-]+)/);
    if (match && match[1]) {
      adapter.markAsUsed("package.json", `scripts:${match[1]}`);
    }
  }
}

export default WireitPlugin;
