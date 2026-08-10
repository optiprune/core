import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const GATSBY_CONFIG_FILES = [
  "gatsby-config.js",
  "gatsby-config.cjs",
  "gatsby-config.mjs",
  "gatsby-config.ts",
  "gatsby-node.js",
  "gatsby-node.cjs",
  "gatsby-node.mjs",
  "gatsby-node.ts",
  "gatsby-browser.js",
  "gatsby-browser.ts",
  "gatsby-ssr.js",
  "gatsby-ssr.ts"
];

const GATSBY_CORE_PACKAGES = [
  "gatsby",
  "gatsby-cli",
  "gatsby-script",
  "gatsby-link"
];

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

export const GatsbyPlugin: AnalyzerPlugin = {
  name: "gatsby-plugin",
  version: "1.0.0",

  detect: async (adapter) => {
    // 1. Check package.json dependencies
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies
      };

      if (
        Object.keys(allDeps).some(
          (dep) => dep === "gatsby" || dep.startsWith("gatsby-")
        )
      ) {
        return true;
      }

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (
          scriptValues.some(
            (s) => typeof s === "string" && (s.includes("gatsby ") || s === "gatsby")
          )
        ) {
          return true;
        }
      }
    }

    // 2. Check for configuration or lifecycle files
    for (const configFile of GATSBY_CONFIG_FILES) {
      if (await adapter.folderExists(configFile)) return true;
    }

    return await adapter.folderExists("src/pages");
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      const allDeps = {
        ...pkg?.dependencies,
        ...pkg?.devDependencies,
        ...pkg?.peerDependencies
      };

      const hasGatsby = Object.keys(allDeps).some(
        (p) => p === "gatsby" || p.startsWith("gatsby-")
      );

      // 1. Safeguard all installed Gatsby core, plugin, source, and transformer packages in package.json
      if (hasGatsby) {
        for (const depName of Object.keys(allDeps)) {
          if (depName === "gatsby" || depName.startsWith("gatsby-")) {
            adapter.markPackageAsUsed(depName);
          }
        }
      }

      // 2. Protect standalone configuration and lifecycle files
      let hasConfigFile = false;
      for (const configFile of GATSBY_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          hasConfigFile = true;
          adapter.markAsUsed(configFile);
        }
      }

      // 3. Protect pages and templates directory
      if (await adapter.folderExists("src/pages")) {
        adapter.markAsUsed("src/pages");
      }
      if (await adapter.folderExists("src/templates")) {
        adapter.markAsUsed("src/templates");
      }

      // 4. Track npm scripts invoking Gatsby CLI
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (
            typeof scriptContent === "string" &&
            (scriptContent.includes("gatsby ") || scriptContent === "gatsby")
          ) {
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            adapter.markPackageAsUsed("gatsby");
          }
        }
      }

      // 5. Report missing dependency if configuration exists without gatsby package
      if (hasConfigFile && !hasGatsby) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message:
            "Gatsby configuration files found, but 'gatsby' is not listed in package.json.",
          evidence: { hasConfigFile }
        });
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Protect Gatsby configuration and lifecycle files
      if (GATSBY_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("gatsby");
      }

      // Protect all page components and route templates in src/pages or src/templates
      if (
        normalized.includes("/src/pages/") ||
        normalized.includes("/src/templates/") ||
        normalized.startsWith("src/pages/") ||
        normalized.startsWith("src/templates/")
      ) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("gatsby");
      }
    },

    onASTNode: (node: any, fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);
      const isConfigFile = GATSBY_CONFIG_FILES.includes(basename);

      // 1. Detect ESM imports for gatsby or gatsby plugins
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (source === "gatsby" || source.startsWith("gatsby-")) {
          adapter.markPackageAsUsed(source);
          adapter.markAsUsed(fileId);
        }
      }

      // 2. Detect CJS require('gatsby-plugin-*')
      if (
        t.isCallExpression(node) &&
        t.isIdentifier(node.callee) &&
        node.callee.name === "require"
      ) {
        const arg = node.arguments[0];
        if (
          t.isStringLiteral(arg) &&
          (arg.value === "gatsby" || arg.value.startsWith("gatsby-"))
        ) {
          adapter.markPackageAsUsed(arg.value);
          adapter.markAsUsed(fileId);
        }
      }

      // 3. Detect GraphQL page / static queries: graphql`query { ... }`
      if (
        t.isTemplateLiteral(node) &&
        node.expressions &&
        t.isIdentifier((node as any).tag) &&
        (node as any).tag.name === "graphql"
      ) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("gatsby");
      }

      // 4. In gatsby-config.js / gatsby-config.ts: extract plugins array
      if (basename.startsWith("gatsby-config")) {
        let configExpr: any = null;

        if (t.isExportDefaultDeclaration(node)) {
          adapter.markAsUsed(fileId, "default");
          adapter.markPackageAsUsed("gatsby");
          configExpr = node.declaration;
        }

        if (
          node?.type === "AssignmentExpression" &&
          node.left?.type === "MemberExpression" &&
          node.left?.object?.name === "module" &&
          node.left?.property?.name === "exports"
        ) {
          adapter.markAsUsed(fileId);
          adapter.markPackageAsUsed("gatsby");
          configExpr = node.right;
        }

        if (configExpr) {
          const processObject = (objExpr: any) => {
            if (!t.isObjectExpression(objExpr)) return;

            objExpr.properties.forEach((prop: any) => {
              if (
                t.isObjectProperty(prop) &&
                t.isIdentifier(prop.key) &&
                prop.key.name === "plugins" &&
                t.isArrayExpression(prop.value)
              ) {
                prop.value.elements.forEach((pluginEl: any) => {
                  // Simple string plugin: 'gatsby-plugin-image'
                  if (t.isStringLiteral(pluginEl)) {
                    adapter.markPackageAsUsed(pluginEl.value);
                  }
                  // Configured plugin object: { resolve: 'gatsby-plugin-manifest', options: { ... } }
                  else if (t.isObjectExpression(pluginEl)) {
                    pluginEl.properties.forEach((pProp: any) => {
                      if (
                        t.isObjectProperty(pProp) &&
                        t.isIdentifier(pProp.key) &&
                        pProp.key.name === "resolve" &&
                        t.isStringLiteral(pProp.value)
                      ) {
                        adapter.markPackageAsUsed(pProp.value.value);
                      }
                    });
                  }
                });
              }
            });
          };

          if (t.isObjectExpression(configExpr)) {
            processObject(configExpr);
          }
        }
      }

      // 5. In gatsby-node.js / gatsby-node.ts: protect Lifecycle API exports (createPages, onCreateNode, etc.)
      if (basename.startsWith("gatsby-node")) {
        if (t.isExportNamedDeclaration(node)) {
          adapter.markAsUsed(fileId);
        }

        if (
          node?.type === "AssignmentExpression" &&
          node.left?.type === "MemberExpression" &&
          node.left?.object?.name === "exports"
        ) {
          if (t.isIdentifier(node.left.property)) {
            adapter.markAsUsed(fileId, node.left.property.name);
          }
        }
      }
    }
  }
};

export default GatsbyPlugin;