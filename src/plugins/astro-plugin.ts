import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const ASTRO_CONFIG_FILES = [
  "astro.config.mjs",
  "astro.config.js",
  "astro.config.ts",
  "astro.config.cjs"
];

const ASTRO_INTEGRATIONS = [
  "@astrojs/tailwind",
  "@astrojs/react",
  "@astrojs/vue",
  "@astrojs/svelte",
  "@astrojs/solid-js",
  "@astrojs/preact",
  "@astrojs/mdx",
  "@astrojs/db",
  "@astrojs/node",
  "@astrojs/cloudflare",
  "@astrojs/vercel",
  "@astrojs/netlify",
  "@astrojs/sitemap",
  "@astrojs/check"
];

const ASTRO_API_EXPORTS = new Set([
  "GET",
  "POST",
  "PUT",
  "DELETE",
  "PATCH",
  "HEAD",
  "OPTIONS",
  "ALL",
  "getStaticPaths",
  "prerender"
]);

export const AstroPlugin: AnalyzerPlugin = {
  name: "astro-plugin",
  version: "1.2.0",

  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      if ("astro" in allDeps) return true;
    }
    for (const file of ASTRO_CONFIG_FILES) {
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

      const hasAstroDep = !!allDeps["astro"];

      let hasConfigFile = false;
      for (const file of ASTRO_CONFIG_FILES) {
        if (await adapter.folderExists(file)) {
          hasConfigFile = true;
          adapter.markAsUsed(file);
          break;
        }
      }

      if (hasAstroDep) {
        adapter.markPackageAsUsed("astro");

        // Protect installed @astrojs/* integrations
        for (const integrationPkg of ASTRO_INTEGRATIONS) {
          if (allDeps[integrationPkg]) {
            adapter.markPackageAsUsed(integrationPkg);
          }
        }
      }

      // Check npm scripts invoking astro CLI
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (typeof scriptContent === "string" && scriptContent.includes("astro")) {
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
          }
        }
      }

      if (hasConfigFile && !hasAstroDep) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message: "Astro configuration found but 'astro' is not listed in package.json.",
          evidence: { hasConfigFile }
        });
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const fileName = path.basename(normalized);

      // 1. Mark .astro component/page files
      if (normalized.endsWith(".astro")) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("astro");
      }

      // 2. Mark Astro route pages inside src/pages/ or src/routes/
      if (normalized.includes("/src/pages/") || normalized.includes("/src/routes/")) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("astro");
      }

      // 3. Mark Content Collections config (src/content/config.ts or src/content.config.ts)
      if (
        normalized.endsWith("src/content/config.ts") ||
        normalized.endsWith("src/content/config.js") ||
        normalized.endsWith("src/content.config.ts") ||
        normalized.endsWith("src/content.config.js")
      ) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("astro");
      }

      // 4. Mark Astro Middleware and Actions (src/middleware.ts, src/actions/index.ts)
      if (
        normalized.endsWith("src/middleware.ts") ||
        normalized.endsWith("src/middleware.js") ||
        normalized.includes("/src/actions/")
      ) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("astro");
      }

      // 5. Mark config files
      if (ASTRO_CONFIG_FILES.includes(fileName)) {
        adapter.markAsUsed(fileId);
      }
    },

    onASTNode: (node, fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const fileName = path.basename(normalized);

      // 1. Detect Astro virtual module imports (astro:content, astro:assets, astro:actions, etc.)
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (source.startsWith("astro:") || source.startsWith("@astrojs/")) {
          adapter.markPackageAsUsed("astro");
          if (source.startsWith("@astrojs/")) {
            adapter.markPackageAsUsed(source);
          }
        }
      }

      // 2. Detect Astro API route exports (GET, POST, getStaticPaths, prerender)
      if (t.isExportNamedDeclaration(node) && node.declaration) {
        const decl = node.declaration;

        // Function Declaration: export function GET() {}
        if (t.isFunctionDeclaration(decl) && decl.id) {
          if (ASTRO_API_EXPORTS.has(decl.id.name)) {
            adapter.markAsUsed(fileId, decl.id.name);
          }
        }

        // Variable Declaration: export const GET = async () => {} or export const prerender = true
        if (t.isVariableDeclaration(decl)) {
          decl.declarations.forEach((vDecl: any) => {
            if (t.isIdentifier(vDecl.id) && ASTRO_API_EXPORTS.has(vDecl.id.name)) {
              adapter.markAsUsed(fileId, vDecl.id.name);
            }
          });
        }
      }

      // 3. Detect Astro global usages (Astro.props, Astro.redirect, Astro.glob)
      if (t.isIdentifier(node) && node.name === "Astro") {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("astro");
      }

      // 4. Detect Astro client directives in JSX (client:load, client:visible, client:only)
      if (t.isJSXAttribute(node)) {
        const attrName = (node.name as any)?.name;
        if (attrName && attrName.startsWith("client:")) {
          adapter.markAsUsed(fileId);
        }
      }

      // 5. Handle astro.config.* exports
      if (ASTRO_CONFIG_FILES.includes(fileName)) {
        if (t.isExportDefaultDeclaration(node)) {
          adapter.markAsUsed(fileId, "default");
        }
      }
    }
  }
};

export default AstroPlugin;