import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

/**
 * Recognized Lit configuration, manifest, and dev server files
 */
const LIT_CONFIG_FILES = [
  "custom-elements.json",
  "lit-analyzer.json",
  ".lit-analyzer.json",
  "web-dev-server.config.mjs",
  "web-dev-server.config.js",
  "web-dev-server.config.cjs",
  "wds.config.mjs",
  "wds.config.js",
  "wds.config.cjs",
];

const LIT_PACKAGES = [
  "lit",
  "lit-element",
  "lit-html",
  "@lit/reactive-element",
  "@lit/task",
  "@lit/context",
  "@lit/react",
  "@lit/localize",
  "@lit/localize-tools",
];

/**
 * Helper to check if an import source is part of the Lit ecosystem
 */
function isLitPackage(source: string): boolean {
  return (
    LIT_PACKAGES.includes(source) ||
    source.startsWith("lit/") ||
    source.startsWith("lit-element/") ||
    source.startsWith("lit-html/") ||
    source.startsWith("@lit/") ||
    source.startsWith("@lit-labs/")
  );
}

export const LitPlugin: AnalyzerPlugin = {
  name: "lit-plugin",
  version: "1.0.0",

  detect: async (adapter) => {
    // 1. Check for dedicated Lit or Custom Elements config files
    for (const configFile of LIT_CONFIG_FILES) {
      if (await adapter.folderExists(configFile)) return true;
    }

    // 2. Check package.json for Lit dependencies or scripts
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies,
      };

      if (Object.keys(allDeps).some((dep) => isLitPackage(dep))) {
        return true;
      }

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (
          scriptValues.some(
            (s) =>
              typeof s === "string" &&
              (/\bwds\b/.test(s) || /\bweb-dev-server\b/.test(s) || /\blit-localize\b/.test(s)),
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

      // 1. Protect dedicated configuration files
      for (const configFile of LIT_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          adapter.markAsUsed(configFile);
        }
      }

      if (pkg) {
        // 2. Protect all lit, @lit/*, and @lit-labs/* packages in package.json
        const allDeps = {
          ...pkg.dependencies,
          ...pkg.devDependencies,
          ...pkg.peerDependencies,
        };

        for (const depName of Object.keys(allDeps)) {
          if (isLitPackage(depName)) {
            // A manifest entry alone is not evidence that this package is used.
            // Usage is marked by the config, script, import, or file hooks below.
          }
        }

        // 3. Mark scripts executing wds, web-dev-server, or lit-localize CLI as used
        if (pkg.scripts) {
          for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
            if (
              typeof scriptContent === "string" &&
              (/\bwds\b/.test(scriptContent) ||
                /\bweb-dev-server\b/.test(scriptContent) ||
                /\blit-localize\b/.test(scriptContent))
            ) {
              adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            }
          }
        }
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Protect configuration files
      if (LIT_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
      }

      // Automatically mark component files (.js, .ts, .jsx, .tsx) for Lit scanning
      if (/\.[jt]sx?$/.test(basename)) {
        adapter.markPackageAsUsed("lit");
      }
    },

    onASTNode: (node: any, fileId: string, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // 1. Inspect AST for Lit imports
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (isLitPackage(source)) {
          adapter.markPackageAsUsed(source);
          adapter.markAsUsed(fileId);
        }
      }

      // 2. Detect @customElement('my-element') class decorator
      if (t.isClassDeclaration(node)) {
        const decorators = (node as any).decorators;
        if (decorators && Array.isArray(decorators)) {
          for (const decorator of decorators) {
            const expr = decorator.expression;
            let decoratorName = "";

            if (t.isCallExpression(expr) && t.isIdentifier(expr.callee)) {
              decoratorName = expr.callee.name;
            } else if (t.isIdentifier(expr)) {
              decoratorName = expr.name;
            }

            if (decoratorName === "customElement") {
              adapter.markAsUsed(fileId);
              if (node.id) {
                adapter.markAsUsed(fileId, node.id.name);
              }
              adapter.markPackageAsUsed("lit");
            }
          }
        }
        const superClass = (node as any).superClass;
        if (
          superClass &&
          t.isIdentifier(superClass) &&
          ["LitElement", "ReactiveElement", "UpdatingElement"].includes(superClass.name)
        ) {
          adapter.markAsUsed(fileId);
          if (node.id) {
            adapter.markAsUsed(fileId, node.id.name);
          }
          adapter.markPackageAsUsed("lit");
        }
      }

      // 3. Detect customElements.define('my-element', MyElement) call expressions
      if (
        t.isCallExpression(node) &&
        t.isMemberExpression(node.callee) &&
        t.isIdentifier(node.callee.object) &&
        node.callee.object.name === "customElements" &&
        t.isIdentifier(node.callee.property) &&
        node.callee.property.name === "define"
      ) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("lit");

        // If second argument is a named identifier: customElements.define('x-foo', XFoo)
        if (node.arguments[1] && t.isIdentifier(node.arguments[1])) {
          adapter.markAsUsed(fileId, node.arguments[1].name);
        }
      }

      // 4. Protect dev server configuration ASTs (web-dev-server.config.mjs, etc.)
      if (basename.startsWith("web-dev-server.config.") || basename.startsWith("wds.config.")) {
        if (t.isExportDefaultDeclaration(node)) {
          adapter.markAsUsed(fileId, "default");
        }

        if (
          t.isAssignmentExpression(node) &&
          t.isMemberExpression(node.left) &&
          t.isIdentifier(node.left.object) &&
          node.left.object.name === "module" &&
          t.isIdentifier(node.left.property) &&
          node.left.property.name === "exports"
        ) {
          adapter.markAsUsed(fileId);
        }
      }
    },
  },
};

export default LitPlugin;
