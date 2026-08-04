import { AnalyzerPlugin } from "./types.js";

/**
 * Utility to check for dependencies in package.json
 */
async function hasDependency(adapter: any, name: string): Promise<boolean> {
  const pkg = await adapter.readJson('package.json');
  if (!pkg) return false;
  return !!(pkg.dependencies?.[name] || pkg.devDependencies?.[name] || pkg.peerDependencies?.[name]);
}

/**
 * React Plugin
 * Handles React-specific patterns like components and hooks.
 */
export const ReactPlugin: AnalyzerPlugin = {
  name: "react-plugin",
  version: "1.1.0",
  detect: async (adapter) => {
    return await hasDependency(adapter, 'react');
  },
  lifecycle: {
    onASTNode: (node: any, fileId, adapter) => {
      let targetNode = node;

      // Unwrap export declarations
      if (
        (node.type === 'ExportNamedDeclaration' || node.type === 'ExportDefaultDeclaration') &&
        node.declaration
      ) {
        targetNode = node.declaration;
      }

      // 1. Function Declarations: function MyComponent() {}
      if (targetNode.type === 'FunctionDeclaration' && targetNode.id && /^[A-Z]/.test(targetNode.id.name)) {
        adapter.markAsUsed(fileId, targetNode.id.name);
      }

      // 2. Variable Declarations: const MyComponent = () => ... or function expression / JSX
      if (targetNode.type === 'VariableDeclaration' && Array.isArray(targetNode.declarations)) {
        for (const decl of targetNode.declarations) {
          if (decl.id?.type === 'Identifier' && /^[A-Z]/.test(decl.id.name)) {
            const init = decl.init;
            if (
              init &&
              (init.type === 'ArrowFunctionExpression' ||
               init.type === 'FunctionExpression' ||
               init.type === 'JSXElement')
            ) {
              adapter.markAsUsed(fileId, decl.id.name);
            }
          }
        }
      }

      // 3. Hooks: useFoo() call expressions
      if (
        node.type === 'CallExpression' &&
        node.callee?.type === 'Identifier' &&
        typeof node.callee.name === 'string' &&
        node.callee.name.startsWith('use')
      ) {
        adapter.markAsUsed(fileId);
      }
    }
  }
};

/**
 * Next.js Plugin
 * Handles Next.js specific entry points and conventions.
 */
export const NextjsPlugin: AnalyzerPlugin = {
  name: "nextjs-plugin",
  version: "1.1.0",
  detect: async (adapter) => {
    return await hasDependency(adapter, 'next');
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const nextConfig = await adapter.readFile('next.config.js') || await adapter.readFile('next.config.mjs');
      if (nextConfig) {
        // Logged/handled if present
      }
    },
    onFileStart: (fileId, adapter) => {
      const filename = fileId.split('/').pop() || '';
      if (['page.tsx', 'page.js', 'layout.tsx', 'layout.js', 'route.ts', 'route.js', 'error.tsx', 'loading.tsx'].includes(filename)) {
        adapter.markAsUsed(fileId);
      }
      if (fileId.includes('/pages/api/')) {
        adapter.markAsUsed(fileId);
      }
    },
    onASTNode: (node: any, fileId, adapter) => {
      if (node.type === 'ExportNamedDeclaration' && node.declaration) {
        const decl = node.declaration;
        if (decl.type === 'FunctionDeclaration' && decl.id) {
          const name = decl.id.name;
          if (['getStaticProps', 'getServerSideProps', 'getStaticPaths', 'generateMetadata', 'generateStaticParams'].includes(name)) {
            adapter.markAsUsed(fileId, name);
          }
        }
      }
    }
  }
};

/**
 * Nuxt Plugin
 * Handles Nuxt-specific directory conventions and auto-imports.
 */
export const NuxtPlugin: AnalyzerPlugin = {
  name: "nuxt-plugin",
  version: "1.1.0",
  detect: async (adapter) => {
    return await hasDependency(adapter, 'nuxt');
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const nuxtConfig = await adapter.readFile('nuxt.config.ts') || await adapter.readFile('nuxt.config.js');
      if (nuxtConfig) {
        // Custom directory configs
      }
    },
    onFileStart: (fileId, adapter) => {
      const pathParts = fileId.split('/');
      if (pathParts.includes('pages') || pathParts.includes('layouts') || pathParts.includes('middleware') || pathParts.includes('server') || pathParts.includes('composables')) {
        adapter.markAsUsed(fileId);
      }
    },
    onASTNode: (node: any, fileId, adapter) => {
      if (node.type === 'CallExpression' && node.callee?.type === 'Identifier') {
        if (['definePageMeta', 'defineNuxtComponent', 'useNuxtApp', 'useFetch', 'defineEventHandler'].includes(node.callee.name)) {
          adapter.markAsUsed(fileId);
        }
      }
    }
  }
};