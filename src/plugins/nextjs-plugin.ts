import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";

/**
 * Next.js Plugin
 * Handles Next.js-specific patterns: page.tsx, route.ts, layout.tsx, middleware, API routes, etc.
 */
export const NextJsPlugin: AnalyzerPlugin = {
  name: "nextjs-plugin",
  version: "1.0.0",
  detect: async (adapter) => {
    const pkg = await adapter.readJson('package.json');
    if (pkg) {
      const hasDep = !!(pkg.dependencies?.['next'] || pkg.devDependencies?.['next']);
      if (hasDep) return true;
    }
    // Fallback: If we see next.config.js, enable it
    const nextConfig = await adapter.readFile('next.config.js');
    return !!nextConfig;
  },
  lifecycle: {
    onFileStart: (fileId, adapter) => {
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

      if (nextJsPatterns.some(pattern => fileId.endsWith(pattern))) {
        adapter.markAsUsed(fileId);
      }
    },
    onASTNode: (node, fileId, adapter) => {
      // Detect Next.js data fetching functions
      if (t.isExportNamedDeclaration(node) || t.isExportDefaultDeclaration(node)) {
        if (t.isFunctionDeclaration(node.declaration) || t.isFunctionExpression(node.declaration)) {
          const funcName = (node.declaration as any).id?.name;
          if (funcName && ['getServerSideProps', 'getStaticProps', 'getStaticPaths', 'generateStaticParams', 'generateMetadata'].includes(funcName)) {
            adapter.markAsUsed(fileId, funcName);
          }
        }
      }

      // Detect Next.js hooks usage (useRouter, usePathname, useSearchParams, etc.)
      if (t.isCallExpression(node) && t.isIdentifier(node.callee)) {
        const hookName = node.callee.name;
        if (['useRouter', 'usePathname', 'useSearchParams', 'useParams', 'useServerInsertedHTML'].includes(hookName)) {
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
    }
  }
};

export default NextJsPlugin;
