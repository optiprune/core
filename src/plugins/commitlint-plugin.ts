import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const COMMITLINT_CONFIG_FILES = [
  ".commitlintrc",
  ".commitlintrc.json",
  ".commitlintrc.yaml",
  ".commitlintrc.yml",
  ".commitlintrc.js",
  ".commitlintrc.cjs",
  ".commitlintrc.mjs",
  ".commitlintrc.ts",
  ".commitlintrc.cts",
  "commitlint.config.js",
  "commitlint.config.cjs",
  "commitlint.config.mjs",
  "commitlint.config.ts",
  "commitlint.config.cts",
];

const COMMITLINT_CORE_PACKAGES = [
  "@commitlint/cli",
  "@commitlint/config-conventional",
  "@commitlint/config-angular",
  "@commitlint/config-lerna",
  "@commitlint/prompt-cli",
  "@commitlint/cz-commitlint",
];

export const CommitlintPlugin: AnalyzerPlugin = {
  name: "commitlint-plugin",
  version: "1.0.0",

  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies,
      };

      if (
        Object.keys(allDeps).some(
          (dep) => dep === "commitlint" || dep.startsWith("@commitlint/"),
        ) ||
        pkg.commitlint
      ) {
        return true;
      }

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (scriptValues.some((s) => typeof s === "string" && s.includes("commitlint"))) {
          return true;
        }
      }
    }

    for (const configFile of COMMITLINT_CONFIG_FILES) {
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
        ...pkg?.peerDependencies,
      };

      const hasCommitlint = Object.keys(allDeps).some(
        (p) => p === "commitlint" || p.startsWith("@commitlint/"),
      );

      // 1. Safeguard installed @commitlint/* packages in package.json
      if (hasCommitlint) {
        for (const depName of Object.keys(allDeps)) {
          if (depName === "commitlint" || depName.startsWith("@commitlint/")) {
            // A manifest entry alone is not evidence that this package is used.
            // Usage is marked by the config, script, import, or file hooks below.
          }
        }
      }

      // 2. Protect commitlint configuration in package.json if present
      if (pkg?.commitlint) {
        adapter.markAsUsed("package.json", "commitlint");

        // Protect extended configs defined in package.json commitlint block
        if (Array.isArray(pkg.commitlint.extends)) {
          pkg.commitlint.extends.forEach((extPkg: string) => {
            if (typeof extPkg === "string") {
              const fullPkg = extPkg.startsWith("@") ? extPkg : `@commitlint/config-${extPkg}`;
              adapter.markPackageAsUsed(fullPkg);
            }
          });
        }
      }

      // 3. Protect standalone config files
      let hasConfigFile = false;
      for (const configFile of COMMITLINT_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          hasConfigFile = true;
          adapter.markConfigFileAsUsed(configFile);
        }
      }

      // 4. Track npm scripts invoking commitlint CLI
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (typeof scriptContent === "string" && scriptContent.includes("commitlint")) {
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            adapter.markPackageAsUsed("@commitlint/cli");
          }
        }
      }

      // 5. Emit finding if config file is present but @commitlint/cli is not listed
      if ((hasConfigFile || pkg?.commitlint) && !hasCommitlint) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message:
            "Commitlint configuration found, but '@commitlint/cli' or configuration preset is not listed in package.json.",
          evidence: { hasConfigFile, hasPkgBlock: !!pkg?.commitlint },
        });
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Protect commitlint configuration files
      if (COMMITLINT_CONFIG_FILES.includes(basename)) {
        adapter.markConfigFileAsUsed(fileId);
        adapter.markPackageAsUsed("@commitlint/cli");
      }
    },

    onASTNode: (node, fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);
      const isConfigFile = COMMITLINT_CONFIG_FILES.includes(basename);

      // 1. Detect ESM imports for @commitlint/* packages in any file
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (source === "commitlint" || source.startsWith("@commitlint/")) {
          adapter.markPackageAsUsed(source);
          adapter.markAsUsed(fileId);
        }
      }

      // 2. Detect CJS require('@commitlint/*') calls
      if (
        t.isCallExpression(node) &&
        t.isIdentifier(node.callee) &&
        node.callee.name === "require"
      ) {
        const arg = node.arguments[0];
        if (
          t.isStringLiteral(arg) &&
          (arg.value === "commitlint" || arg.value.startsWith("@commitlint/"))
        ) {
          adapter.markPackageAsUsed(arg.value);
          adapter.markAsUsed(fileId);
        }
      }

      // 3. In Commitlint config files, inspect default/named exports and extends array
      if (isConfigFile) {
        if (t.isExportDefaultDeclaration(node)) {
          adapter.markAsUsed(fileId, "default");
          adapter.markPackageAsUsed("@commitlint/cli");
        }

        // CJS module.exports = { ... }
        if (
          node?.type === "AssignmentExpression" &&
          (node as any).left?.type === "MemberExpression" &&
          (node as any).left?.object?.name === "module" &&
          (node as any).left?.property?.name === "exports"
        ) {
          adapter.markAsUsed(fileId);
          adapter.markPackageAsUsed("@commitlint/cli");
        }

        // Detect extends property: extends: ['@commitlint/config-conventional']
        if (t.isObjectProperty(node) && t.isIdentifier(node.key) && node.key.name === "extends") {
          if (t.isArrayExpression(node.value)) {
            node.value.elements.forEach((el: any) => {
              if (t.isStringLiteral(el)) {
                const extValue = el.value;
                const fullPkg = extValue.startsWith("@")
                  ? extValue
                  : `@commitlint/config-${extValue}`;
                adapter.markPackageAsUsed(fullPkg);
              }
            });
          } else if (t.isStringLiteral(node.value)) {
            const extValue = node.value.value;
            const fullPkg = extValue.startsWith("@") ? extValue : `@commitlint/config-${extValue}`;
            adapter.markPackageAsUsed(fullPkg);
          }
        }

        // Detect plugins property: plugins: ['commitlint-plugin-custom']
        if (t.isObjectProperty(node) && t.isIdentifier(node.key) && node.key.name === "plugins") {
          if (t.isArrayExpression(node.value)) {
            node.value.elements.forEach((el: any) => {
              if (t.isStringLiteral(el)) {
                const pluginVal = el.value;
                const fullPkg = pluginVal.startsWith("commitlint-plugin-")
                  ? pluginVal
                  : `commitlint-plugin-${pluginVal}`;
                adapter.markPackageAsUsed(fullPkg);
              }
            });
          }
        }
      }
    },
  },
};

export default CommitlintPlugin;
