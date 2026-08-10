import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const NEXT_CONFIG_FILES = ['next.config.js', 'next.config.mjs', 'next.config.ts', 'next.config.cjs'];

const NEXT_SPECIAL_FILES = new Set([
  'page.tsx', 'page.ts', 'page.jsx', 'page.js',
  'route.ts', 'route.js',
  'layout.tsx', 'layout.ts', 'layout.jsx', 'layout.js',
  'middleware.ts', 'middleware.js',
  'error.tsx', 'error.ts', 'error.jsx', 'error.js',
  'global-error.tsx', 'global-error.ts', 'global-error.jsx', 'global-error.js',
  'loading.tsx', 'loading.ts', 'loading.jsx', 'loading.js',
  'not-found.tsx', 'not-found.ts', 'not-found.jsx', 'not-found.js',
  'template.tsx', 'template.ts', 'template.jsx', 'template.js',
  'default.tsx', 'default.ts', 'default.jsx', 'default.js',
  'instrumentation.ts', 'instrumentation.js',
  'sitemap.ts', 'sitemap.js',
  'robots.ts', 'robots.js',
  'manifest.ts', 'manifest.json',
  'icon.tsx', 'icon.ts', 'icon.jsx', 'icon.js',
  'apple-icon.tsx', 'apple-icon.ts',
  'opengraph-image.tsx', 'opengraph-image.ts',
  'twitter-image.tsx', 'twitter-image.ts'
]);

const NEXT_EXPORTS = new Set([
  'getServerSideProps',
  'getStaticProps',
  'getStaticPaths',
  'generateStaticParams',
  'generateMetadata',
  'generateViewport',
  'revalidate',
  'dynamic',
  'dynamicParams',
  'fetchCache',
  'runtime',
  'preferredRegion',
  'maxDuration'
]);

export const NextjsPlugin: AnalyzerPlugin = {
  name: "nextjs-plugin",
  version: "1.3.0",

  detect: async (adapter) => {
    const pkg = await adapter.readJson('package.json');
    if (pkg && (pkg.dependencies?.['next'] || pkg.devDependencies?.['next'])) {
      adapter.markPackageAsUsed('next');
      return true;
    }
    for (const file of NEXT_CONFIG_FILES) {
      if (await adapter.folderExists(file)) return true;
    }
    return false;
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson('package.json');
      const hasNext = pkg ? !!(pkg.dependencies?.['next'] || pkg.devDependencies?.['next']) : false;

      let hasConfigFile = false;
      for (const file of NEXT_CONFIG_FILES) {
        if (await adapter.folderExists(file)) {
          hasConfigFile = true;
          adapter.markAsUsed(file);
          break;
        }
      }

      if (hasNext) {
        adapter.markPackageAsUsed('next');

        // Protect @next/third-parties or @next/bundle-analyzer if present
        if (pkg?.dependencies?.['@next/third-parties'] || pkg?.devDependencies?.['@next/third-parties']) {
          adapter.markPackageAsUsed('@next/third-parties');
        }
        if (pkg?.dependencies?.['@next/bundle-analyzer'] || pkg?.devDependencies?.['@next/bundle-analyzer']) {
          adapter.markPackageAsUsed('@next/bundle-analyzer');
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
          message: "Next.js configuration found but 'next' is not listed in package.json.",
          evidence: { hasConfigFile }
        });
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const filename = path.basename(normalized);

      // 1. Mark Next.js specific convention files (page.tsx, layout.tsx, route.ts, sitemap.ts, etc.)
      if (NEXT_SPECIAL_FILES.has(filename)) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed('next');
      }

      // 2. Mark legacy Pages Router API routes (/pages/api/*) or custom _app / _document
      if (
        normalized.includes('/pages/api/') ||
        normalized.endsWith('/pages/_app.tsx') ||
        normalized.endsWith('/pages/_app.jsx') ||
        normalized.endsWith('/pages/_document.tsx') ||
        normalized.endsWith('/pages/_document.jsx')
      ) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed('next');
      }

      // 3. Mark config files
      if (NEXT_CONFIG_FILES.includes(filename)) {
        adapter.markAsUsed(fileId);
      }
    },

    onASTNode: (node, fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const filename = path.basename(normalized);

      // 1. Detect Next.js package imports (next/navigation, next/image, next/font, etc.)
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (source === 'next' || source.startsWith('next/')) {
          adapter.markPackageAsUsed('next');
        }
      }

      // 2. Detect exported Next.js data fetching functions, metadata, and route config
      if (t.isExportNamedDeclaration(node) && node.declaration) {
        const decl = node.declaration;

        // Function Declaration: export function generateMetadata() {}
        if (t.isFunctionDeclaration(decl) && decl.id) {
          if (NEXT_EXPORTS.has(decl.id.name)) {
            adapter.markAsUsed(fileId, decl.id.name);
          }
        }

        // Variable Declaration: export const generateMetadata = () => {} or export const revalidate = 60
        if (t.isVariableDeclaration(decl)) {
          decl.declarations.forEach((vDecl: any) => {
            if (t.isIdentifier(vDecl.id) && NEXT_EXPORTS.has(vDecl.id.name)) {
              adapter.markAsUsed(fileId, vDecl.id.name);
            }
          });
        }
      }

      // 3. Detect Next.js hooks usage (useRouter, usePathname, useSearchParams, etc.)
      if (t.isCallExpression(node) && t.isIdentifier(node.callee)) {
        const hookName = node.callee.name;
        if (hookName.startsWith('use') && ['useRouter', 'usePathname', 'useSearchParams', 'useParams', 'useServerInsertedHTML', 'useFormStatus', 'useFormState'].includes(hookName)) {
          adapter.markAsUsed(fileId);
          adapter.markPackageAsUsed('next');
        }
      }

      // 4. Handle next.config.js default exports
      if (NEXT_CONFIG_FILES.includes(filename)) {
        if (t.isExportDefaultDeclaration(node)) {
          adapter.markAsUsed(fileId, "default");
        }
      }
    }
  }
};

export default NextjsPlugin;