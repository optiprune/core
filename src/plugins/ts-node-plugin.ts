import { AnalyzerPlugin } from "../types.js";

const TS_NODE_PACKAGES = ["ts-node", "tsconfig-paths"];

const TS_NODE_CONFIG_FILES = ["tsconfig.json", "tsconfig.node.json"];

function parseJsonc<T = any>(content: string): T | null {
  try {
    const cleanJson = content
      .replace(/\/\/.*/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/,(\s*[\]}])/g, "$1");
    return JSON.parse(cleanJson);
  } catch {
    return null;
  }
}

export const TsNodePlugin: AnalyzerPlugin = {
  name: "ts-node-plugin",
  version: "1.0.0",

  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (TS_NODE_PACKAGES.some((pkgName) => pkgName in allDeps)) {
        return true;
      }

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (
          scriptValues.some(
            (s) => typeof s === "string" && (s.includes("ts-node") || s.includes("ts-node/register"))
          )
        ) {
          return true;
        }
      }
    }

    for (const configFile of TS_NODE_CONFIG_FILES) {
      if (await adapter.folderExists(configFile)) return true;
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

      const hasTsNodeDep = TS_NODE_PACKAGES.some((p) => p in allDeps);
      let isTsNodeUsedInScripts = false;

      // 1. Safeguard installed ts-node packages in package.json
      if (hasTsNodeDep) {
        for (const tsNodePkg of TS_NODE_PACKAGES) {
          if (allDeps[tsNodePkg]) {
            adapter.markPackageAsUsed(tsNodePkg);
          }
        }
      }

      // 2. Inspect package.json scripts for ts-node invocations
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (typeof scriptContent !== "string") continue;

          if (
            scriptContent.includes("ts-node") ||
            scriptContent.includes("ts-node/register") ||
            scriptContent.includes("ts-node/esm")
          ) {
            isTsNodeUsedInScripts = true;

            // Mark the npm script and ts-node package as used
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            adapter.markPackageAsUsed("ts-node");

            if (scriptContent.includes("tsconfig-paths")) {
              adapter.markPackageAsUsed("tsconfig-paths");
            }

            // Extract target TypeScript file argument (e.g., "ts-node src/index.ts" -> "src/index.ts")
            const tokens = scriptContent.split(/\s+/).filter((t) => t.trim().length > 0);
            const tsNodeIdx = tokens.findIndex((t) => t.includes("ts-node"));

            if (tsNodeIdx !== -1) {
              let argIdx = tsNodeIdx + 1;

              // Skip CLI flags (e.g. -r, --transpile-only, --project, -E)
              while (argIdx < tokens.length) {
                const token = tokens[argIdx];
                if (!token) break;

                if (token.startsWith("-")) {
                  // Skip flag value if it takes an argument (like --project tsconfig.json or -r ts-node/register)
                  if (["-r", "--require", "-p", "--project", "--compiler", "-C"].includes(token)) {
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
                  targetFile.endsWith(".js"))
              ) {
                adapter.markAsUsed(targetFile);
              }
            }
          }
        }
      }

      // 3. Inspect tsconfig.json for "ts-node" configuration options
      for (const configFile of TS_NODE_CONFIG_FILES) {
        const content = await adapter.readFile(configFile);
        if (!content) continue;

        const tsconfig = parseJsonc(content);
        if (tsconfig?.["ts-node"]) {
          adapter.markAsUsed(configFile);
          adapter.markPackageAsUsed("ts-node");

          // Protect custom require plugins inside tsconfig.json "ts-node" block
          if (Array.isArray(tsconfig["ts-node"]?.require)) {
            tsconfig["ts-node"].require.forEach((reqPkg: string) => {
              if (typeof reqPkg === "string" && !reqPkg.startsWith(".")) {
                adapter.markPackageAsUsed(reqPkg);
              }
            });
          }
        }
      }

      // 4. Report missing dependency if ts-node is referenced in scripts without package.json entry
      if (isTsNodeUsedInScripts && !hasTsNodeDep) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message:
            "Scripts in package.json invoke 'ts-node', but 'ts-node' is not listed in dependencies or devDependencies.",
          evidence: { isTsNodeUsedInScripts }
        });
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");

      // Protect custom loader files or ts-node registration scripts
      if (normalized.includes("ts-node") || normalized.includes("register.js")) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("ts-node");
      }
    },

    onASTNode: (node, fileId, adapter) => {
      // Detect programmatic ts-node registration: require('ts-node').register() or import 'ts-node/register'
      if (node.type === "ImportDeclaration" && typeof node.source.value === "string") {
        if (node.source.value.startsWith("ts-node")) {
          adapter.markPackageAsUsed("ts-node");
          adapter.markAsUsed(fileId);
        }
      }

      if (
        node.type === "CallExpression" &&
        node.callee?.type === "Identifier" &&
        node.callee.name === "require"
      ) {
        const arg = node.arguments[0];
        if (arg?.type === "Literal" && typeof arg.value === "string" && arg.value.startsWith("ts-node")) {
          adapter.markPackageAsUsed("ts-node");
          adapter.markAsUsed(fileId);
        }
      }
    }
  }
};

export default TsNodePlugin;