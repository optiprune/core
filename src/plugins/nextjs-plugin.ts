import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const NEXT_CONFIG_FILES = ['next.config.js', 'next.config.mjs', 'next.config.ts', 'next.config.cjs'];

/**
 * Next.js Plugin
 * Handles Next.js specific entry points and conventions.
 */
export const NextjsPlugin: AnalyzerPlugin = {
  name: "nextjs-plugin",
  version: "1.2.0",
  detect: async (adapter) => {
    const pkg = await adapter.readJson('package.json');
    if (pkg && (pkg.dependencies?.['next'] || pkg.devDependencies?.['next'])) {
      return true;
    }
    for (const file of NEXT_CONFIG_FILES) {
      if ((await adapter.readFile(file)) !== null) return true;
    }
    return false;
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson('package.json');
      const hasNext = pkg ? !!(pkg.dependencies?.['next'] || pkg.devDependencies?.['next']) : false;
      
      let hasConfigFile = false;
      for (const file of NEXT_CONFIG_FILES) {
        if ((await adapter.readFile(file)) !== null) {
          hasConfigFile = true;
          break;
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
      const filename = path.basename(fileId);
      
      // Mark Next.js conventional files as entry points
      const nextJsPatterns = [
        'page.tsx', 'page.ts', 'page.jsx', 'page.js',
        'route.ts', 'route.js',
        'layout.tsx', 'layout.ts', 'layout.jsx', 'layout.js',
        'middleware.ts', 'middleware.js',
        'error.tsx', 'error.ts',
        'loading.tsx', 'loading.ts',
        'not-found.tsx', 'not-found.ts',
        'template.tsx', 'template.ts',
        'default.tsx', 'default.ts'
      ];

      if (nextJsPatterns.includes(filename)) {
        adapter.markAsUsed(fileId);
      }
      
      if (fileId.includes('/pages/api/') || fileId.includes('/app/')) {
        adapter.markAsUsed(fileId);
      }
      
      if (NEXT_CONFIG_FILES.includes(filename)) {
        adapter.markAsUsed(fileId);
      }
    },
    onASTNode: (node, fileId, adapter) => {
      // Detect Next.js data fetching functions and metadata exports
      if (t.isExportNamedDeclaration(node) && node.declaration) {
        const decl = node.declaration;
        if (t.isFunctionDeclaration(decl) && decl.id) {
          const name = decl.id.name;
          if (['getServerSideProps', 'getStaticProps', 'getStaticPaths', 'generateStaticParams', 'generateMetadata'].includes(name)) {
            adapter.markAsUsed(fileId, name);
          }
        }
      }

      // Detect Next.js hooks usage
      if (t.isCallExpression(node) && t.isIdentifier(node.callee)) {
        const hookName = node.callee.name;
        if (hookName.startsWith('use') && ['useRouter', 'usePathname', 'useSearchParams', 'useParams', 'useServerInsertedHTML'].includes(hookName)) {
          adapter.markAsUsed(fileId);
        }
      }

      // Mark files using Image component
      if (t.isJSXElement(node) && t.isJSXIdentifier(node.openingElement.name)) {
        const tagName = (node.openingElement.name as any).name;
        if (tagName === 'Image') {
          adapter.markAsUsed(fileId);
        }
      }
      
      // Handle next.config.js exports
      const filename = path.basename(fileId);
      if (NEXT_CONFIG_FILES.includes(filename)) {
        if (node.type === "ExportDefaultDeclaration") {
          adapter.markAsUsed(fileId, "default");
        }
      }
    }
  }
};

export default NextjsPlugin;
