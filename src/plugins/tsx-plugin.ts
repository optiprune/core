import { AnalyzerPlugin } from "../types.js";
import path from "pathe";

const TSX_PACKAGES = [
  "tsx",
  "esbuild-register",
  "@esbuild-kit/cjs-loader",
  "@esbuild-kit/esm-loader"
];

export const TsxPlugin: AnalyzerPlugin = {
  name: "tsx-plugin",
  version: "1.2.0",

  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies
      };
      if (TSX_PACKAGES.some((pkgName) => pkgName in allDeps)) {
        return true;
      }

      if (pkg.scripts) {
        return Object.values(pkg.scripts).some(
          (script) =>
            typeof script === "string" &&
            (script.includes("tsx") || script.includes("esbuild-register"))
        );
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

      const hasTsxDep = TSX_PACKAGES.some((p) => p in allDeps);
      let isTsxUsedInScripts = false;

      // 1. Protect installed tsx / esbuild-register packages in package.json
      if (hasTsxDep) {
        for (const tsxPkg of TSX_PACKAGES) {
          if (allDeps[tsxPkg]) {
            adapter.markPackageAsUsed(tsxPkg);
          }
        }
      }

      // 2. Inspect package.json scripts for tsx execution
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (typeof scriptContent !== "string") continue;

          if (
            scriptContent.includes("tsx") ||
            scriptContent.includes("esbuild-register")
          ) {
            isTsxUsedInScripts = true;

            // Mark npm script entry and tsx package as used
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            adapter.markPackageAsUsed("tsx");

            if (scriptContent.includes("esbuild-register")) {
              adapter.markPackageAsUsed("esbuild-register");
            }

            // Extract target TypeScript entry point after tsx command & flags
            const tokens = scriptContent
              .split(/\s+/)
              .filter((t) => t.trim().length > 0);

            const tsxIndex = tokens.findIndex(
              (t) => t === "tsx" || t.endsWith("/tsx") || t.endsWith("\\tsx")
            );

            if (tsxIndex !== -1) {
              let argIdx = tsxIndex + 1;

              // Skip tsx subcommands (e.g. "tsx watch src/index.ts")
              if (tokens[argIdx] === "watch") {
                argIdx++;
              }

              // Skip flags like --test, --env-file, -r, --import
              while (argIdx < tokens.length) {
                const token = tokens[argIdx];
                if (!token) break;

                if (token.startsWith("-")) {
                  // Skip flags with values (e.g. --env-file=.env or -r tsx)
                  if (
                    [
                      "-r",
                      "--require",
                      "--import",
                      "-c",
                      "--tsconfig",
                      "--env-file"
                    ].includes(token)
                  ) {
                    argIdx += 2;
                  } else {
                    argIdx += 1;
                  }
                } else {
                  break;
                }
              }

              const targetFile = tokens[argIdx];
              if (
                targetFile &&
                (targetFile.endsWith(".ts") ||
                  targetFile.endsWith(".tsx") ||
                  targetFile.endsWith(".mts") ||
                  targetFile.endsWith(".cts") ||
                  targetFile.endsWith(".js") ||
                  targetFile.endsWith(".jsx"))
              ) {
                adapter.markAsUsed(targetFile);
              }
            }
          }
        }
      }

      if (isTsxUsedInScripts && !hasTsxDep) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message:
            "Scripts in package.json invoke 'tsx', but 'tsx' is not listed in dependencies or devDependencies.",
          evidence: { isTsxUsedInScripts }
        });
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");

      // Mark files that contain tsx or esbuild loader references
      if (
        normalized.includes("tsx") ||
        normalized.includes("esbuild-register")
      ) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("tsx");
      }
    },

    onASTNode: (node, fileId, adapter) => {
      // Detect ESM imports or CJS require for tsx / esbuild-register
      if (node.type === "ImportDeclaration" && typeof node.source.value === "string") {
        if (node.source.value.startsWith("tsx") || node.source.value.startsWith("esbuild-register")) {
          adapter.markPackageAsUsed(node.source.value);
          adapter.markAsUsed(fileId);
        }
      }

      if (
        node.type === "CallExpression" &&
        (node.callee as any)?.name === "require"
      ) {
        const arg = node.arguments[0];
        if (
          arg?.type === "Literal" &&
          typeof arg.value === "string" &&
          (arg.value.startsWith("tsx") || arg.value.startsWith("esbuild-register"))
        ) {
          adapter.markPackageAsUsed(arg.value);
          adapter.markAsUsed(fileId);
        }
      }
    }
  }
};

export default TsxPlugin;