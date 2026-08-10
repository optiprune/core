import { AnalyzerPlugin } from "../types.js";
import path from "pathe";

const PRECONSTRUCT_PACKAGES = [
  "@preconstruct/cli",
  "@preconstruct/hook",
  "@preconstruct/babel-plugin"
];

export const PreconstructPlugin: AnalyzerPlugin = {
  name: "preconstruct-plugin",
  version: "1.2.0",

  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies
      };

      if (
        Object.keys(allDeps).some(
          (dep) =>
            dep === "@preconstruct/cli" || dep.startsWith("@preconstruct/")
        ) ||
        pkg.preconstruct
      ) {
        return true;
      }

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (
          scriptValues.some(
            (s) =>
              typeof s === "string" &&
              (s.includes("preconstruct ") || s === "preconstruct")
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

      const hasPreconstructDep = Object.keys(allDeps).some(
        (p) => p === "@preconstruct/cli" || p.startsWith("@preconstruct/")
      );

      // 1. Safeguard installed Preconstruct packages in package.json
      if (hasPreconstructDep) {
        for (const depName of Object.keys(allDeps)) {
          if (
            depName === "@preconstruct/cli" ||
            depName.startsWith("@preconstruct/")
          ) {
            adapter.markPackageAsUsed(depName);
          }
        }
      }

      // 2. Track package.json "preconstruct" configuration block
      if (pkg?.preconstruct) {
        adapter.markAsUsed("package.json", "preconstruct");

        const preconstructConfig = pkg.preconstruct;

        // Process monorepo package globs: packages: ["packages/*"]
        if (Array.isArray(preconstructConfig.packages)) {
          if (typeof (adapter as any).setWorkspaceGlobs === "function") {
            (adapter as any).setWorkspaceGlobs(preconstructConfig.packages);
          }
          if (typeof (adapter as any).setRepoType === "function") {
            (adapter as any).setRepoType("monorepo");
          }

          preconstructConfig.packages.forEach((globPath: unknown) => {
            if (typeof globPath === "string") {
              adapter.markAsUsed(globPath);
            }
          });
        }

        // Process entry point definitions: entrypoints: ["index.ts", "extra/*"]
        if (Array.isArray(preconstructConfig.entrypoints)) {
          preconstructConfig.entrypoints.forEach((entry: unknown) => {
            if (typeof entry === "string") {
              adapter.markAsUsed(entry);
              // Normalize entries like "extra/*" by marking the directory root
              const cleanEntry = entry.replace(/\/\*$/, "");
              adapter.markAsUsed(cleanEntry);
            }
          });
        } else if (typeof preconstructConfig.entrypoints === "string") {
          const entry = preconstructConfig.entrypoints;
          adapter.markAsUsed(entry);
          adapter.markAsUsed(entry.replace(/\/\*$/, ""));
        }
      }

      // 3. Track npm scripts invoking Preconstruct CLI
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (
            typeof scriptContent === "string" &&
            (scriptContent.includes("preconstruct ") || scriptContent === "preconstruct")
          ) {
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            adapter.markPackageAsUsed("@preconstruct/cli");
          }
        }
      }

      // 4. Emit finding if preconstruct configuration exists without CLI package
      if (pkg?.preconstruct && !hasPreconstructDep) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message:
            "Preconstruct configuration found in package.json, but '@preconstruct/cli' is not listed under devDependencies.",
          evidence: { hasPreconstructConfig: true }
        });
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      if (basename === "package.json") {
        adapter.markPackageAsUsed("@preconstruct/cli");
      }
    }
  }
};

export default PreconstructPlugin;