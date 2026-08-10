import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";

const DOTENV_FILES = [
  ".env",
  ".env.local",
  ".env.development",
  ".env.production",
  ".env.test"
];

const DOTENV_PACKAGES = ["dotenv", "dotenv-expand", "dotenv-flow"];

export const DotenvPlugin: AnalyzerPlugin = {
  name: "dotenv-plugin",
  version: "1.0.2",

  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (DOTENV_PACKAGES.some((p) => p in allDeps)) return true;
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
      for (const envPkg of DOTENV_PACKAGES) {
        if (allDeps[envPkg]) {
          adapter.markPackageAsUsed(envPkg);
        }
      }

      // Collect defined env keys per file: { fileId: string, key: string, line: number }
      const definedEnvKeys: Array<{ fileId: string; key: string; line: number }> = [];

      // Scan and parse all .env files safely
      for (const envFile of DOTENV_FILES) {
        const content = await adapter.readFile(envFile);
        if (!content) continue;

        adapter.markAsUsed(envFile);

        const lines = content.split("\n");
        lines.forEach((lineText, index) => {
          const trimmed = lineText.trim();
          // Skip comments or empty lines
          if (!trimmed || trimmed.startsWith("#")) return;

          const match = trimmed.match(/^(?:export\s+)?([a-zA-Z_][a-zA-Z0-9_]*)\s*=/);
          if (match?.[1]) {
            definedEnvKeys.push({
              fileId: envFile,
              key: match[1],
              line: index + 1 // 1-based line number
            });
          }
        });
      }

      // Attach defined env keys state for checking during AST traversal
      (adapter as any)._dotenvState = {
        definedEnvKeys,
        referencedKeys: new Set<string>()
      };
    },

    onASTNode: (node, fileId, adapter) => {
      const state = (adapter as any)._dotenvState;
      if (!state) return;

      const referencedKeys: Set<string> = state.referencedKeys;

      // 1. Detect process.env.MY_SECRET
      if (t.isMemberExpression(node)) {
        const obj = node.object;
        const prop = node.property;

        if (
          t.isMemberExpression(obj) &&
          t.isIdentifier(obj.object) &&
          obj.object.name === "process" &&
          t.isIdentifier(obj.property) &&
          obj.property.name === "env" &&
          t.isIdentifier(prop)
        ) {
          referencedKeys.add(prop.name);
        }

        // 2. Detect import.meta.env.MY_SECRET (Vite / Astro / Nuxt / SvelteKit)
        if (
          t.isMemberExpression(obj) &&
          (obj.object as any)?.type === "MetaProperty" &&
          t.isIdentifier(obj.property) &&
          obj.property.name === "env" &&
          t.isIdentifier(prop)
        ) {
          referencedKeys.add(prop.name);
        }
      }

      // 3. Detect Destructuring: const { MY_SECRET } = process.env
      if (t.isVariableDeclarator(node) && node.id.type === "ObjectPattern") {
        const init = node.init;
        if (
          init &&
          t.isMemberExpression(init) &&
          t.isIdentifier(init.object) &&
          init.object.name === "process" &&
          t.isIdentifier(init.property) &&
          init.property.name === "env"
        ) {
          (node.id as any).properties?.forEach((p: any) => {
            const keyName = p.key?.name || p.key?.value;
            if (keyName) referencedKeys.add(keyName);
          });
        }
      }
    }
  }
};

export default DotenvPlugin;