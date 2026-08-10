import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const NEXT_CONFIG_FILES = [
  "next.config.js",
  "next.config.mjs",
  "next.config.ts",
  "next.config.cjs"
];

const NEXT_MDX_PROVIDER_FILES = [
  "mdx-components.tsx",
  "mdx-components.jsx",
  "mdx-components.js",
  "mdx-components.ts"
];

const NEXT_SPECIAL_FILES = new Set([
  // TypeScript & JavaScript route files
  "page.tsx", "page.ts", "page.jsx", "page.js",
  "route.ts", "route.js",
  "layout.tsx", "layout.ts", "layout.jsx", "layout.js",
  "middleware.ts", "middleware.js",
  "error.tsx", "error.ts", "error.jsx", "error.js",
  "global-error.tsx", "global-error.ts", "global-error.jsx", "global-error.js",
  "loading.tsx", "loading.ts", "loading.jsx", "loading.js",
  "not-found.tsx", "not-found.ts", "not-found.jsx", "not-found.js",
  "template.tsx", "template.ts", "template.jsx", "template.js",
  "default.tsx", "default.ts", "default.jsx", "default.js",
  "instrumentation.ts", "instrumentation.js",
  "sitemap.ts", "sitemap.js",
  "robots.ts", "robots.js",
  "manifest.ts", "manifest.json",
  "icon.tsx", "icon.ts", "icon.jsx", "icon.js",
  "apple-icon.tsx", "apple-icon.ts",
  "opengraph-image.tsx", "opengraph-image.ts",
  "twitter-image.tsx", "twitter-image.ts",

  // Next.js MDX route files (@next/mdx)
  "page.mdx", "page.md",
  "layout.mdx", "layout.md"
]);

const NEXT_EXPORTS = new Set([
  "getServerSideProps",
  "getStaticProps",
  "getStaticPaths",
  "generateStaticParams",
  "generateMetadata",
  "generateViewport",
  "revalidate",
  "dynamic",
  "dynamicParams",
  "fetchCache",
  "runtime",
  "preferredRegion",
  "maxDuration"
]);

const NEXT_ECOSYSTEM_PACKAGES = [
  "@next/third-parties",
  "@next/bundle-analyzer",
  "@next/mdx",
  "@mdx-js/react",
  "@mdx-js/loader"
];

export const NextjsPlugin: AnalyzerPlugin = {
  name: "nextjs-plugin",
  version: "1.4.0",

  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (pkg && (pkg.dependencies?.["next"] || pkg.devDependencies?.["next"])) {
      adapter.markPackageAsUsed("next");
      return true;
    }
    for (const file of NEXT_CONFIG_FILES) {
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

      const hasNext = !!allDeps["next"];

      let hasConfigFile = false;
      for (const file of NEXT_CONFIG_FILES) {
        if (await adapter.folderExists(file)) {
          hasConfigFile = true;
          adapter.markAsUsed(file);
          break;
        }
      }

      // Protect Next.js MDX Provider file (mdx-components.tsx) if present
      for (const providerFile of NEXT_MDX_PROVIDER_FILES) {
        if (await adapter.folderExists(providerFile)) {
          adapter.markAsUsed(providerFile);
          if (allDeps["@next/mdx"]) {
            adapter.markPackageAsUsed("@next/mdx");
          }
        }
      }

      if (hasNext) {
        adapter.markPackageAsUsed("next");

        // Protect Next.js ecosystem packages if installed
        for (const ecoPkg of NEXT_ECOSYSTEM_PACKAGES) {
          if (allDeps[ecoPkg]) {
            adapter.markPackageAsUsed(ecoPkg);
          }
        }
      }

      // Mark npm scripts calling next CLI
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (typeof scriptContent === "string" && scriptContent.includes("next ")) {
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
          }
        }
      }

      if (hasConfigFile && !hasNext) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message:
            "Next.js configuration found but 'next' is not listed in package.json.",
          evidence: { hasConfigFile }
        });
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const filename = path.basename(normalized);

      // 1. Mark Next.js specific convention files (page.tsx, layout.tsx, page.mdx, etc.)
      if (NEXT_SPECIAL_FILES.has(filename)) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("next");
        if (filename.endsWith(".mdx") || filename.endsWith(".md")) {
          adapter.markPackageAsUsed("@next/mdx");
        }
      }

      // 2. Mark Next.js MDX component provider (mdx-components.tsx/jsx)
      if (NEXT_MDX_PROVIDER_FILES.includes(filename)) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("@next/mdx");
      }

      // 3. Mark legacy Pages Router API routes (/pages/api/*) or custom _app / _document
      if (
        normalized.includes("/pages/api/") ||
        normalized.endsWith("/pages/_app.tsx") ||
        normalized.endsWith("/pages/_app.jsx") ||
        normalized.endsWith("/pages/_document.tsx") ||
        normalized.endsWith("/pages/_document.jsx")
      ) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("next");
      }

      // 4. Mark config files
      if (NEXT_CONFIG_FILES.includes(filename)) {
        adapter.markAsUsed(fileId);
      }
    },

    onASTNode: (node, fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const filename = path.basename(normalized);

      // 1. Detect Next.js and @next/mdx package imports
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (source === "next" || source.startsWith("next/")) {
          adapter.markPackageAsUsed("next");
        } else if (
          source === "@next/mdx" ||
          source === "@mdx-js/react" ||
          source === "@mdx-js/loader"
        ) {
          adapter.markPackageAsUsed(source);
          adapter.markAsUsed(fileId);
        }
      }

      // 2. Detect exported Next.js data fetching functions, metadata, and route config
      if (t.isExportNamedDeclaration(node) && node.declaration) {
        const decl = node.declaration;

        if (t.isFunctionDeclaration(decl) && decl.id) {
          if (NEXT_EXPORTS.has(decl.id.name)) {
            adapter.markAsUsed(fileId, decl.id.name);
          }
        }

        if (t.isVariableDeclaration(decl)) {
          decl.declarations.forEach((vDecl: any) => {
            if (t.isIdentifier(vDecl.id) && NEXT_EXPORTS.has(vDecl.id.name)) {
              adapter.markAsUsed(fileId, vDecl.id.name);
            }
          });
        }
      }

      // 3. Detect Next.js hooks usage (useRouter, usePathname, etc.)
      if (t.isCallExpression(node) && t.isIdentifier(node.callee)) {
        const hookName = node.callee.name;
        if (
          hookName.startsWith("use") &&
          [
            "useRouter",
            "usePathname",
            "useSearchParams",
            "useParams",
            "useServerInsertedHTML",
            "useFormStatus",
            "useFormState"
          ].includes(hookName)
        ) {
          adapter.markAsUsed(fileId);
          adapter.markPackageAsUsed("next");
        }

        // Detect withMDX({ ... }) wrapper in next.config.js / next.config.mjs
        if (hookName === "withMDX" || hookName === "createMDX") {
          adapter.markAsUsed(fileId);
          adapter.markPackageAsUsed("@next/mdx");
        }
      }

      // 4. Handle next.config.js and mdx-components.tsx default exports
      if (
        NEXT_CONFIG_FILES.includes(filename) ||
        NEXT_MDX_PROVIDER_FILES.includes(filename)
      ) {
        if (
          t.isExportDefaultDeclaration(node) ||
          t.isExportNamedDeclaration(node)
        ) {
          adapter.markAsUsed(fileId);
        }
      }
    }
  }
};

export default NextjsPlugin;