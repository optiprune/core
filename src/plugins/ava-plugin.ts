import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const AVA_CONFIG_FILES = [
  "ava.config.js",
  "ava.config.cjs",
  "ava.config.mjs",
  "ava.config.ts"
];

const AVA_ECOSYSTEM_PACKAGES = [
  "ava",
  "@ava/typescript",
  "@ava/babel",
  "ts-node",
  "tsx"
];

export const AvaPlugin: AnalyzerPlugin = {
  name: "ava-plugin",
  version: "1.0.0",

  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies
      };
      if (AVA_ECOSYSTEM_PACKAGES.some((pkgName) => pkgName in allDeps) || pkg.ava) {
        return true;
      }

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (
          scriptValues.some(
            (s) => typeof s === "string" && (s.includes("ava") || s === "ava")
          )
        ) {
          return true;
        }
      }
    }

    for (const configFile of AVA_CONFIG_FILES) {
      if (await adapter.folderExists(configFile)) return true;
    }

    return await adapter.folderExists("test");
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      const allDeps = {
        ...pkg?.dependencies,
        ...pkg?.devDependencies,
        ...pkg?.peerDependencies
      };

      const hasAvaDep = AVA_ECOSYSTEM_PACKAGES.some((p) => p in allDeps);

      // 1. Safeguard installed Ava ecosystem packages in package.json
      if (hasAvaDep) {
        for (const avaPkg of AVA_ECOSYSTEM_PACKAGES) {
          if (allDeps[avaPkg]) {
            adapter.markPackageAsUsed(avaPkg);
          }
        }
      }

      // 2. Protect standalone config files or package.json ava block
      let hasConfigFile = false;
      for (const configFile of AVA_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          hasConfigFile = true;
          adapter.markAsUsed(configFile);
        }
      }

      if (pkg?.ava) {
        hasConfigFile = true;
        adapter.markAsUsed("package.json", "ava");

        // Protect require modules defined in package.json ava block
        if (Array.isArray(pkg.ava.require)) {
          pkg.ava.require.forEach((reqPkg: string) => {
            if (typeof reqPkg === "string") {
              if (reqPkg.startsWith(".") || reqPkg.startsWith("/")) {
                adapter.markAsUsed(reqPkg);
              } else {
                const pkgName = reqPkg.split("/")[0];
                if (pkgName) adapter.markPackageAsUsed(pkgName);
              }
            }
          });
        }
      }

      // 3. Track npm scripts invoking Ava
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (
            typeof scriptContent === "string" &&
            (scriptContent.includes("ava") || scriptContent === "ava")
          ) {
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            adapter.markPackageAsUsed("ava");
          }
        }
      }

      // 4. Report missing dependency if configuration exists without ava package
      if (hasConfigFile && !hasAvaDep) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message: "Ava configuration found, but 'ava' is not listed in package.json.",
          evidence: { hasConfigFile }
        });
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Protect configuration files
      if (AVA_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("ava");
      }

      // Protect test files in test/ or matching *.test.* / *.spec.*
      if (
        normalized.includes(".test.") ||
        normalized.includes(".spec.") ||
        normalized.includes("/test/") ||
        normalized.includes("/tests/")
      ) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("ava");
      }
    },

    onASTNode: (node, fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);
      const isConfigFile = AVA_CONFIG_FILES.includes(basename);

      // 1. Detect ESM imports for Ava and extensions (import test from 'ava')
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (source === "ava" || source.startsWith("@ava/")) {
          adapter.markPackageAsUsed(source);
          adapter.markAsUsed(fileId);
        }
      }

      // 2. In Ava configuration files (ava.config.js / ava.config.ts)
      if (isConfigFile) {
        if (t.isExportDefaultDeclaration(node)) {
          adapter.markAsUsed(fileId, "default");
          adapter.markPackageAsUsed("ava");
        }

        // CJS module.exports = { ... }
        if (
          node?.type === "AssignmentExpression" &&
          (node as any).left?.type === "MemberExpression" &&
          (node as any).left?.object?.name === "module" &&
          (node as any).left?.property?.name === "exports"
        ) {
          adapter.markAsUsed(fileId);
          adapter.markPackageAsUsed("ava");
        }

        // Detect require: ['ts-node/register'] or typescript config block
        if (t.isObjectProperty(node) && t.isIdentifier(node.key)) {
          const keyName = node.key.name;

          if (keyName === "require") {
            if (t.isArrayExpression(node.value)) {
              node.value.elements.forEach((el: any) => {
                if (t.isStringLiteral(el)) {
                  const reqVal = el.value;
                  if (reqVal.startsWith(".") || reqVal.startsWith("/")) {
                    adapter.markAsUsed(reqVal);
                  } else {
                    const pkgName = reqVal.split("/")[0];
                    if (pkgName) adapter.markPackageAsUsed(pkgName);
                  }
                }
              });
            } else if (t.isStringLiteral(node.value)) {
              const reqVal = node.value.value;
              if (reqVal.startsWith(".") || reqVal.startsWith("/")) {
                adapter.markAsUsed(reqVal);
              } else {
                const pkgName = reqVal.split("/")[0];
                if (pkgName) adapter.markPackageAsUsed(pkgName);
              }
            }
          }

          if (keyName === "typescript") {
            adapter.markPackageAsUsed("@ava/typescript");
          }
        }
      }
    }
  }
};

export default AvaPlugin;