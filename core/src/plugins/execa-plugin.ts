import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const EXECA_PACKAGES = ["execa", "gulp-execa"];

const EXECA_FUNCTIONS = new Set([
  "execa",
  "execaSync",
  "execaCommand",
  "execaCommandSync",
  "execaNode",
  "$",
]);

export const ExecaPlugin: AnalyzerPlugin = {
  name: "execa-plugin",
  version: "1.0.0",

  detect: async (adapter) => {
    // 1. Check package.json dependencies
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies,
      };

      if (Object.keys(allDeps).some((dep) => EXECA_PACKAGES.includes(dep))) {
        return true;
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
        ...pkg?.peerDependencies,
      };

      // Dependency declarations alone are not usage evidence. Imports and
      // configuration/script hooks below provide the package usage marks.
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);
    },

    onASTNode: (node: any, fileId, adapter) => {
      // 1. Detect ESM imports for execa or gulp-execa
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (EXECA_PACKAGES.includes(source)) {
          adapter.markPackageAsUsed(source);
          adapter.markAsUsed(fileId);
        }
      }

      // 2. Detect CJS require('execa')
      if (
        t.isCallExpression(node) &&
        t.isIdentifier(node.callee) &&
        node.callee.name === "require"
      ) {
        const arg = node.arguments[0];
        if (t.isStringLiteral(arg) && EXECA_PACKAGES.includes(arg.value)) {
          adapter.markPackageAsUsed(arg.value);
          adapter.markAsUsed(fileId);
        }
      }

      // 3. Detect Tagged Template Literal Execa Invocations: execa`npm run build`, $`git status`, execa.$`ls`
      if (node.type === "TaggedTemplateExpression") {
        let tagName: string | null = null;

        if (t.isIdentifier(node.tag)) {
          tagName = node.tag.name;
        } else if (t.isMemberExpression(node.tag) && t.isIdentifier(node.tag.property)) {
          tagName = node.tag.property.name;
        }

        if (tagName && EXECA_FUNCTIONS.has(tagName)) {
          adapter.markAsUsed(fileId);
          adapter.markPackageAsUsed("execa");

          const rawText = node.quasi?.quasis?.map((q: any) => q.value?.raw ?? "").join(" ");

          if (rawText) {
            parseExecaCommandString(rawText, adapter);
          }
        }
      }
      // 4. Detect Programmatic Execa Call Expressions: execa('node', ['src/script.js']) or execaNode('child.js')
      if (t.isCallExpression(node)) {
        let calleeName: string | null = null;

        if (t.isIdentifier(node.callee)) {
          calleeName = node.callee.name;
        } else if (t.isMemberExpression(node.callee) && t.isIdentifier(node.callee.property)) {
          // Handles execa.sync('npm', ['test']) or execa.$('ls')
          calleeName = node.callee.property.name;
        } else if (
          t.isCallExpression(node.callee) &&
          t.isIdentifier(node.callee.callee) &&
          EXECA_FUNCTIONS.has(node.callee.callee.name)
        ) {
          // Handle curried options calls: execa({ verbose: true })('npm', ['test'])
          calleeName = node.callee.callee.name;
        }

        if (calleeName && EXECA_FUNCTIONS.has(calleeName)) {
          adapter.markAsUsed(fileId);
          adapter.markPackageAsUsed("execa");

          const firstArg = node.arguments[0];

          // Special handling for execaNode('src/script.js')
          if (calleeName === "execaNode" && t.isStringLiteral(firstArg)) {
            adapter.markAsUsed(firstArg.value);
          }

          // Single string command: execa('npm run test')
          if (t.isStringLiteral(firstArg)) {
            parseExecaCommandString(firstArg.value, adapter);
          }

          // Command with args array: execa('node', ['src/worker.js'])
          const secondArg = node.arguments[1];
          if (
            t.isStringLiteral(firstArg) &&
            ["node", "ts-node", "tsx", "bun"].includes(firstArg.value) &&
            t.isArrayExpression(secondArg)
          ) {
            secondArg.elements.forEach((el: any) => {
              if (t.isStringLiteral(el) && el.value.includes(".")) {
                adapter.markAsUsed(el.value);
              }
            });
          }
        }
      }
    },
  },
};

/**
 * Parses raw command strings executed via execa to mark referenced npm scripts or npx tools
 */
function parseExecaCommandString(cmdStr: string, adapter: any): void {
  // Extract npx package invocations: "npx eslint ."
  if (cmdStr.includes("npx ")) {
    const parts = cmdStr.split("npx ")[1]?.trim().split(" ");
    const pkgName = parts?.find((p) => !p.startsWith("-"));
    if (pkgName) {
      adapter.markPackageAsUsed(pkgName);
    }
  }

  // Extract npm run / yarn / pnpm / bun script invocations: "npm run build"
  if (
    cmdStr.includes("npm run ") ||
    cmdStr.includes("yarn ") ||
    cmdStr.includes("pnpm ") ||
    cmdStr.includes("pnpm run ") ||
    cmdStr.includes("bun run ") ||
    cmdStr.includes("bun ")
  ) {
    const match = cmdStr.match(/(?:npm run|yarn|pnpm run|pnpm|bun run|bun)\s+([a-zA-Z0-9_:-]+)/);
    if (match && match[1]) {
      const scriptName = match[1].replace(/['"[\]]/g, "");
      if (!["test", "build", "install", "run", "add", "start"].includes(scriptName)) {
        adapter.markAsUsed("package.json", `scripts:${scriptName}`);
      } else if (["test", "build", "start"].includes(scriptName)) {
        adapter.markAsUsed("package.json", `scripts:${scriptName}`);
      }
    }
  }
}

export default ExecaPlugin;
