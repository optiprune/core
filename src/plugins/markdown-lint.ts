import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const MARKDOWNLINT_CONFIG_FILES = [
  ".markdownlint.json",
  ".markdownlint.jsonc",
  ".markdownlint.yaml",
  ".markdownlint.yml",
  ".markdownlint.cjs",
  ".markdownlint.mjs",
  ".markdownlint.js",
  ".markdownlint-cli2.jsonc",
  ".markdownlint-cli2.yaml",
  ".markdownlint-cli2.cjs",
  ".markdownlint-cli2.mjs",
  ".markdownlint-cli2.js"
];

const MARKDOWNLINT_PACKAGES = [
  "markdownlint",
  "markdownlint-cli",
  "markdownlint-cli2",
  "markdownlint-rule-helpers"
];

export const MarkdownlintPlugin: AnalyzerPlugin = {
  name: "markdownlint-plugin",
  version: "1.0.0",

  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies
      };
      if (MARKDOWNLINT_PACKAGES.some((pkgName) => pkgName in allDeps)) {
        return true;
      }

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (
          scriptValues.some(
            (s) =>
              typeof s === "string" &&
              (s.includes("markdownlint") || s.includes("markdownlint-cli2"))
          )
        ) {
          return true;
        }
      }
    }

    for (const configFile of MARKDOWNLINT_CONFIG_FILES) {
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

      const hasMarkdownlintDep = MARKDOWNLINT_PACKAGES.some((p) => p in allDeps);
      let isUsedInScripts = false;

      // 1. Safeguard installed markdownlint ecosystem packages in package.json
      // Package manifest presence alone is not usage evidence;
      // config, script, import, and file hooks provide the usage marks.

      // 2. Protect markdownlint configuration files
      let hasConfigFile = false;
      for (const configFile of MARKDOWNLINT_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          hasConfigFile = true;
          adapter.markAsUsed(configFile);
        }
      }

      // 3. Inspect package.json scripts for markdownlint execution
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (typeof scriptContent !== "string") continue;

          if (
            scriptContent.includes("markdownlint") ||
            scriptContent.includes("markdownlint-cli2")
          ) {
            isUsedInScripts = true;

            // Mark the npm script entry and CLI package as used
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);

            if (scriptContent.includes("markdownlint-cli2")) {
              adapter.markPackageAsUsed("markdownlint-cli2");
            } else {
              adapter.markPackageAsUsed("markdownlint-cli");
            }

            // Extract target markdown files/globs (e.g., "markdownlint '**/*.md'")
            const tokens = scriptContent
              .split(/\s+/)
              .filter((t) => t.trim().length > 0);

            const mlIndex = tokens.findIndex(
              (t) => t.includes("markdownlint") || t.includes("markdownlint-cli2")
            );

            if (mlIndex !== -1) {
              let argIdx = mlIndex + 1;

              while (argIdx < tokens.length) {
                const token = tokens[argIdx];
                if (!token) break;

                if (token.startsWith("-")) {
                  if (
                    ["-c", "--config", "-i", "--ignore", "-r", "--rules"].includes(
                      token
                    )
                  ) {
                    argIdx += 2;
                  } else {
                    argIdx += 1;
                  }
                } else {
                  break;
                }
              }

              const targetFile = tokens[argIdx]?.replace(/['"]/g, "");
              if (
                targetFile &&
                (targetFile.endsWith(".md") ||
                  targetFile.endsWith(".markdown") ||
                  targetFile.includes("*"))
              ) {
                adapter.markAsUsed(targetFile);
              }
            }
          }
        }
      }

      // 4. Report missing dependency if configuration exists without package installation
      if (hasConfigFile && !hasMarkdownlintDep) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message:
            "Markdownlint configuration file found, but 'markdownlint' / 'markdownlint-cli' is not listed in package.json.",
          evidence: { hasConfigFile }
        });
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Protect markdownlint configuration files
      if (MARKDOWNLINT_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("markdownlint");
      }
    },

    onASTNode: (node, fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);
      const isConfigFile = MARKDOWNLINT_CONFIG_FILES.includes(basename);

      // 1. Detect ESM imports for markdownlint / custom rule helpers
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (
          MARKDOWNLINT_PACKAGES.includes(source) ||
          source.startsWith("markdownlint-rule-")
        ) {
          adapter.markPackageAsUsed(source);
          adapter.markAsUsed(fileId);
        }
      }

      // 2. Detect CJS require('markdownlint') calls
      if (
        t.isCallExpression(node) &&
        t.isIdentifier(node.callee) &&
        node.callee.name === "require"
      ) {
        const arg = node.arguments[0];
        if (
          t.isStringLiteral(arg) &&
          (MARKDOWNLINT_PACKAGES.includes(arg.value) ||
            arg.value.startsWith("markdownlint-rule-"))
        ) {
          adapter.markPackageAsUsed(arg.value);
          adapter.markAsUsed(fileId);
        }
      }

      // 3. Handle default exports in JS/MJS/CJS config files
      if (isConfigFile) {
        if (t.isExportDefaultDeclaration(node)) {
          adapter.markAsUsed(fileId, "default");
          adapter.markPackageAsUsed("markdownlint");
        }

        // CJS module.exports = { ... }
        if (
          node?.type === "AssignmentExpression" &&
          (node as any).left?.type === "MemberExpression" &&
          (node as any).left?.object?.name === "module" &&
          (node as any).left?.property?.name === "exports"
        ) {
          adapter.markAsUsed(fileId);
          adapter.markPackageAsUsed("markdownlint");
        }
      }
    }
  }
};

export default MarkdownlintPlugin;