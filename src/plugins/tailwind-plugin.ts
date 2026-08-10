import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const TAILWIND_CONFIG_FILES = [
  "tailwind.config.js",
  "tailwind.config.ts",
  "tailwind.config.cjs",
  "tailwind.config.mjs"
];

const TAILWIND_PACKAGES = [
  "tailwindcss",
  "@tailwindcss/vite",
  "@tailwindcss/postcss",
  "@tailwindcss/cli",
  "@tailwindcss/typography",
  "@tailwindcss/forms",
  "@tailwindcss/aspect-ratio",
  "@tailwindcss/container-queries",
  "tailwindcss-animate"
];

export const TailwindPlugin: AnalyzerPlugin = {
  name: "tailwind-plugin",
  version: "1.2.0",

  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (TAILWIND_PACKAGES.some((pkgName) => pkgName in allDeps)) {
        return true;
      }
    }

    for (const file of TAILWIND_CONFIG_FILES) {
      if (await adapter.folderExists(file)) return true;
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

      const hasTailwindDep = TAILWIND_PACKAGES.some((p) => p in allDeps);

      let hasConfigFile = false;
      for (const file of TAILWIND_CONFIG_FILES) {
        if (await adapter.folderExists(file)) {
          hasConfigFile = true;
          adapter.markAsUsed(file);
          break;
        }
      }

      // Mark all installed Tailwind packages as used
      if (hasTailwindDep) {
        for (const tailwindPkg of TAILWIND_PACKAGES) {
          if (allDeps[tailwindPkg]) {
            adapter.markPackageAsUsed(tailwindPkg);
          }
        }
      }

      // Check npm scripts running tailwind CLI
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (
            typeof scriptContent === "string" &&
            (scriptContent.includes("tailwindcss") || scriptContent.includes("@tailwindcss/cli"))
          ) {
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
          }
        }
      }

      if (hasConfigFile && !hasTailwindDep) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message: "Tailwind configuration found but 'tailwindcss' is not listed in package.json.",
          evidence: { hasConfigFile }
        });
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");

      if (TAILWIND_CONFIG_FILES.some((pattern) => normalized.endsWith(pattern))) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("tailwindcss");
      }

      // Mark CSS files containing Tailwind v3 directives or Tailwind v4 @import "tailwindcss"
      if (normalized.endsWith(".css") || normalized.endsWith(".scss")) {
        adapter.markAsUsed(fileId);
      }
    },

    onASTNode: (node, fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const fileName = path.basename(normalized);

      if (!TAILWIND_CONFIG_FILES.includes(fileName)) return;

      // 1. Mark exports in tailwind.config.*
      if (t.isExportDefaultDeclaration(node)) {
        adapter.markAsUsed(fileId, "default");
      }

      // Support for module.exports
      if (
        t.isAssignmentExpression(node) &&
        t.isMemberExpression(node.left) &&
        (node.left as any).object?.name === "module" &&
        (node.left as any).property?.name === "exports"
      ) {
        adapter.markAsUsed(fileId);
      }

      // 2. Detect ESM imports of Tailwind plugins (e.g. import typography from '@tailwindcss/typography')
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (source.includes("tailwindcss") || source.startsWith("@tailwindcss/")) {
          adapter.markPackageAsUsed(source);
          adapter.markAsUsed(fileId);
        }
      }

      // 3. Detect plugins array in tailwind.config.js
      if (t.isObjectProperty(node) || node.type === "Property") {
        const keyName = (node.key as any)?.name || (node.key as any)?.value;

        if (keyName === "plugins" && t.isArrayExpression(node.value)) {
          node.value.elements.forEach((el: any) => {
            // Case A: require('@tailwindcss/typography')
            if (t.isCallExpression(el) && t.isIdentifier(el.callee) && el.callee.name === "require") {
              const arg = el.arguments[0];
              if (t.isStringLiteral(arg)) {
                adapter.markPackageAsUsed(arg.value);
              }
            } 
            // Case B: '@tailwindcss/typography' string literal
            else if (t.isStringLiteral(el) || (el.type === "Literal" && typeof el.value === "string")) {
              adapter.markPackageAsUsed(el.value);
            }
          });
        }
      }
    }
  }
};

export default TailwindPlugin;