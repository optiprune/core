import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const POPULAR_UNPLUGINS = [
  "unplugin",
  "unplugin-auto-import",
  "unplugin-icons",
  "unplugin-vue-components",
  "@intlify/unplugin-vue-i18n",
  "unplugin-vue-markdown",
  "unplugin-vue-router",
  "unplugin-swc",
  "unplugin-turbo",
  "unplugin-element-plus",
  "unplugin-ast",
  "unplugin-fonts",
];

function isUnpluginPackage(pkgName: string): boolean {
  return (
    pkgName === "unplugin" ||
    pkgName.startsWith("unplugin-") ||
    pkgName.includes("/unplugin-") ||
    pkgName.includes("unplugin")
  );
}

export const UnpluginPlugin: AnalyzerPlugin = {
  name: "unplugin-plugin",
  version: "1.2.0",

  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (!pkg) return false;

    const allDeps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
      ...pkg.peerDependencies,
    };

    return Object.keys(allDeps).some((dep) => isUnpluginPackage(dep));
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      const allDeps = {
        ...pkg?.dependencies,
        ...pkg?.devDependencies,
        ...pkg?.peerDependencies,
      };

      // 1. Safeguard all installed unplugin packages in package.json
      for (const depName of Object.keys(allDeps)) {
        if (isUnpluginPackage(depName)) {
          // A manifest entry alone is not evidence that this package is used.
          // Usage is marked by the config, script, import, or file hooks below.
        }
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Protect auto-generated unplugin declaration files (e.g., auto-imports.d.ts, components.d.ts, typed-router.d.ts)
      if (
        basename === "auto-imports.d.ts" ||
        basename === "components.d.ts" ||
        basename === "typed-router.d.ts"
      ) {
        adapter.markAsUsed(fileId);
      }
    },

    onASTNode: (node: any, fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");

      // 1. Detect ESM imports for unplugin packages (e.g. import Icons from 'unplugin-icons/vite')
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (isUnpluginPackage(source)) {
          adapter.markAsUsed(fileId);

          // Extract root package name from subpath imports (e.g., 'unplugin-icons/vite' -> 'unplugin-icons')
          const pkgName = source.startsWith("@")
            ? source.split("/").slice(0, 2).join("/")
            : source.split("/")[0];

          if (pkgName) {
            adapter.markPackageAsUsed(pkgName);
          }
        }
      }

      // 2. Detect CommonJS require('unplugin-auto-import/vite')
      if (
        t.isCallExpression(node) &&
        t.isIdentifier(node.callee) &&
        node.callee.name === "require"
      ) {
        const arg = node.arguments[0];
        if (t.isStringLiteral(arg) && isUnpluginPackage(arg.value)) {
          adapter.markAsUsed(fileId);

          const pkgName = arg.value.startsWith("@")
            ? arg.value.split("/").slice(0, 2).join("/")
            : arg.value.split("/")[0];

          if (pkgName) {
            adapter.markPackageAsUsed(pkgName);
          }
        }
      }

      // 3. Detect unplugin function calls or sub-bundler invocations in config files
      // e.g. AutoImport({ ... }), Icons({ ... }), Components.vite({ ... }), UnpluginVueI18n.webpack({ ... })
      if (t.isCallExpression(node)) {
        let calleeName: string | null = null;

        if (t.isIdentifier(node.callee)) {
          calleeName = node.callee.name;
        } else if (t.isMemberExpression(node.callee) && t.isIdentifier(node.callee.object)) {
          calleeName = node.callee.object.name;
        }

        if (calleeName) {
          if (
            calleeName.startsWith("unplugin") ||
            calleeName.includes("AutoImport") ||
            calleeName.includes("Icons") ||
            calleeName.includes("Components") ||
            calleeName.includes("VueRouter") ||
            calleeName.includes("VueMarkdown") ||
            calleeName.includes("VueI18n")
          ) {
            adapter.markAsUsed(fileId);
          }
        }
      }
    },
  },
};

export default UnpluginPlugin;
