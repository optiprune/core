import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";

const DOTENV_FILES = [
  ".env",
  ".env.local",
  ".env.development",
  ".env.production",
  ".env.test",
  ".env.example"
];

const DOTENV_PACKAGES = ["dotenv", "dotenv-expand", "dotenv-flow", "dotenvx"];

export const DotenvPlugin: AnalyzerPlugin = {
  name: "dotenv-plugin",
  version: "1.1.0",

  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (DOTENV_PACKAGES.some((p) => p in allDeps)) return true;

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (scriptValues.some((s) => typeof s === "string" && s.includes("dotenv"))) {
          return true;
        }
      }
    }

    for (const file of DOTENV_FILES) {
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

      // Protect installed dotenv packages
      // Do not treat a manifest entry as usage evidence.

      // Check npm scripts using CLI flags (e.g. "dotenv -e .env -- node index.js")
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (typeof scriptContent === "string" && scriptContent.includes("dotenv")) {
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            adapter.markPackageAsUsed("dotenv");
          }
        }
      }

      const definedEnvKeys: Array<{ fileId: string; key: string; line: number }> = [];

      // Scan and parse all .env files
      for (const envFile of DOTENV_FILES) {
        const content = await adapter.readFile(envFile);
        if (!content) continue;

        adapter.markAsUsed(envFile);

        const lines = content.split("\n");
        lines.forEach((lineText, index) => {
          const trimmed = lineText.trim();
          if (!trimmed || trimmed.startsWith("#")) return;

          const match = trimmed.match(/^(?:export\s+)?([a-zA-Z_][a-zA-Z0-9_]*)\s*=/);
          if (match?.[1]) {
            definedEnvKeys.push({
              fileId: envFile,
              key: match[1],
              line: index + 1
            });
          }
        });
      }

      // Attach state for tracking
      (adapter as any)._dotenvState = {
        definedEnvKeys,
        referencedKeys: new Set<string>()
      };
    },

    onASTNode: (node, fileId, adapter) => {
      const state = (adapter as any)._dotenvState;
      if (!state) return;

      const referencedKeys: Set<string> = state.referencedKeys;

      // 1. Detect direct imports: import "dotenv/config" or require("dotenv")
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (source && DOTENV_PACKAGES.some((p) => source === p || source.startsWith(`${p}/`))) {
          // Split always yields at least 1 element if source is truthy
          const pkgName = source.split("/")[0]!;
          adapter.markPackageAsUsed(pkgName);
          adapter.markAsUsed(fileId);
        }
      }

      // 2. Member Expression Access: process.env.KEY or process.env["KEY"] or import.meta.env.KEY
      if (t.isMemberExpression(node)) {
        const obj = node.object;
        const prop = node.property;

        const isProcessEnv =
          t.isMemberExpression(obj) &&
          t.isIdentifier(obj.object) &&
          obj.object.name === "process" &&
          t.isIdentifier(obj.property) &&
          obj.property.name === "env";

        const isImportMetaEnv =
          t.isMemberExpression(obj) &&
          (obj.object as any)?.type === "MetaProperty" &&
          t.isIdentifier(obj.property) &&
          obj.property.name === "env";

        if (isProcessEnv || isImportMetaEnv) {
          if (t.isIdentifier(prop)) {
            referencedKeys.add(prop.name);
          } else if (t.isStringLiteral(prop)) {
            referencedKeys.add(prop.value);
          }
        }
      }

      // 3. Destructuring Access: const { MY_VAR, "OTHER_VAR": alias } = process.env / import.meta.env
      if (t.isVariableDeclarator(node) && node.id.type === "ObjectPattern") {
        const init = node.init;
        if (!init) return;

        const isProcessEnv =
          t.isMemberExpression(init) &&
          t.isIdentifier(init.object) &&
          init.object.name === "process" &&
          t.isIdentifier(init.property) &&
          init.property.name === "env";

        const isImportMetaEnv =
          t.isMemberExpression(init) &&
          (init.object as any)?.type === "MetaProperty" &&
          t.isIdentifier(init.property) &&
          init.property.name === "env";

        if (isProcessEnv || isImportMetaEnv) {
          (node.id as any).properties?.forEach((p: any) => {
            if (t.isObjectProperty(p)) {
              const keyName = t.isIdentifier(p.key)
                ? p.key.name
                : t.isStringLiteral(p.key)
                ? p.key.value
                : null;
              if (keyName) referencedKeys.add(keyName);
            }
          });
        }
      }
    },

    // Matches PluginLifecycle.onAnalysisComplete interface hook
    onAnalysisComplete: async (adapter) => {
      const state = (adapter as any)._dotenvState;
      if (!state) return;

      const { definedEnvKeys, referencedKeys } = state;

      for (const item of definedEnvKeys) {
        // Skip .env.example keys from being reported as unused
        if (item.fileId.endsWith(".env.example")) continue;

        if (!referencedKeys.has(item.key)) {
          adapter.emitFinding({
            rule: "unused-environment-variable",
            severity: "warning",
            confidence: "medium",
            file: item.fileId,
            location: {
              start: { line: item.line, column: 1 },
              end: { line: item.line, column: item.key.length + 1 }
            },
            message: `Environment variable '${item.key}' is defined in ${item.fileId} but never referenced in code.`,
            evidence: { key: item.key }
          });
        }
      }
    }
  }
};

export default DotenvPlugin;