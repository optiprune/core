import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const PANDA_CONFIG_FILES = [
  "panda.config.ts",
  "panda.config.js",
  "panda.config.mjs",
  "panda.config.cjs",
  "panda.config.mts",
  "panda.config.cts",
  "panda.config.json"
];

const PANDA_APIS = new Set([
  "css",
  "cva",
  "sva",
  "cx",
  "stack",
  "vstack",
  "hstack",
  "box",
  "flex",
  "grid",
  "container",
  "circle",
  "square",
  "center",
  "float",
  "aspect",
  "spacer",
  "divider"
]);

export const PandaCssPlugin: AnalyzerPlugin = {
  name: "panda-css-plugin",
  version: "1.2.0",

  detect: async (adapter) => {
    // 1. Check package.json dependencies and scripts
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies
      };

      if (
        Object.keys(allDeps).some(
          (dep) => dep === "@pandacss/dev" || dep.startsWith("@pandacss/")
        )
      ) {
        return true;
      }

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (
          scriptValues.some(
            (s) =>
              typeof s === "string" && (s.includes("panda ") || s === "panda")
          )
        ) {
          return true;
        }
      }
    }

    // 2. Check for Panda configuration files
    for (const configFile of PANDA_CONFIG_FILES) {
      if (await adapter.folderExists(configFile)) return true;
    }

    return await adapter.folderExists("styled-system");
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      const allDeps = {
        ...pkg?.dependencies,
        ...pkg?.devDependencies,
        ...pkg?.peerDependencies
      };

      const hasPanda = Object.keys(allDeps).some(
        (p) => p === "@pandacss/dev" || p.startsWith("@pandacss/")
      );

      // 1. Safeguard installed Panda packages in package.json
      if (hasPanda) {
        for (const depName of Object.keys(allDeps)) {
          if (depName === "@pandacss/dev" || depName.startsWith("@pandacss/")) {
            // A manifest entry alone is not evidence that this package is used.
            // Usage is marked by the config, script, import, or file hooks below.
          }
        }
      }

      // 2. Protect standalone configuration files
      let hasConfigFile = false;
      for (const configFile of PANDA_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          hasConfigFile = true;
          adapter.markAsUsed(configFile);
        }
      }

      // 3. Protect generated styled-system directory if present
      if (await adapter.folderExists("styled-system")) {
        adapter.markAsUsed("styled-system");
      }

      // 4. Track npm scripts invoking Panda CLI
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (
            typeof scriptContent === "string" &&
            (scriptContent.includes("panda ") || scriptContent === "panda")
          ) {
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            adapter.markPackageAsUsed("@pandacss/dev");
          }
        }
      }

      // 5. Emit finding if config exists without @pandacss/dev package
      if (hasConfigFile && !hasPanda) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message:
            "Panda CSS configuration found, but '@pandacss/dev' is not listed in package.json.",
          evidence: { hasConfigFile }
        });
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Protect Panda configuration files
      if (PANDA_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("@pandacss/dev");
      }

      // Protect generated styled-system files
      if (
        normalized.includes("/styled-system/") ||
        normalized.startsWith("styled-system/")
      ) {
        adapter.markAsUsed(fileId);
      }
    },

    onASTNode: (node: any, fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);
      const isConfigFile = PANDA_CONFIG_FILES.includes(basename);

      // 1. Detect ESM imports for @pandacss/* or styled-system
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (source.startsWith("@pandacss/") || source.includes("styled-system")) {
          adapter.markAsUsed(fileId);
          if (source.startsWith("@pandacss/")) {
            adapter.markPackageAsUsed(source);
          }
        }
      }

      // 2. Detect Panda CSS API function calls: css({...}), vstack({...}), cva({...})
      if (t.isCallExpression(node) && t.isIdentifier(node.callee)) {
        if (PANDA_APIS.has(node.callee.name)) {
          adapter.markAsUsed(fileId);
        }
      }

      // 3. Inspect Panda configuration files
      if (isConfigFile) {
        let configExpr: any = null;

        if (t.isExportDefaultDeclaration(node)) {
          adapter.markAsUsed(fileId, "default");
          adapter.markPackageAsUsed("@pandacss/dev");
          configExpr = node.declaration;
        }

        // CommonJS module.exports = { ... }
        if (
          node?.type === "AssignmentExpression" &&
          node.left?.type === "MemberExpression" &&
          node.left?.object?.name === "module" &&
          node.left?.property?.name === "exports"
        ) {
          adapter.markAsUsed(fileId);
          adapter.markPackageAsUsed("@pandacss/dev");
          configExpr = node.right;
        }

        if (configExpr) {
          const processObject = (objExpr: any) => {
            if (!t.isObjectExpression(objExpr)) return;

            objExpr.properties.forEach((prop: any) => {
              if (t.isObjectProperty(prop) && t.isIdentifier(prop.key)) {
                // Extract custom outdir: outdir: 'my-styled-system'
                if (
                  prop.key.name === "outdir" &&
                  t.isStringLiteral(prop.value)
                ) {
                  adapter.markAsUsed(prop.value.value);
                }

                // Extract custom includes: include: ['./src/**/*.{ts,tsx}']
                if (
                  prop.key.name === "include" &&
                  t.isArrayExpression(prop.value)
                ) {
                  prop.value.elements.forEach((el: any) => {
                    if (t.isStringLiteral(el)) {
                      adapter.markAsUsed(el.value);
                    }
                  });
                }
              }
            });
          };

          // Unwrap defineConfig(...) call expressions
          if (t.isCallExpression(configExpr)) {
            const firstArg = configExpr.arguments[0];
            if (t.isObjectExpression(firstArg)) {
              processObject(firstArg);
            }
          } else if (t.isObjectExpression(configExpr)) {
            processObject(configExpr);
          }
        }
      }
    }
  }
};

export default PandaCssPlugin;