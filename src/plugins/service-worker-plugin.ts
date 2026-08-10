import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const WORKBOX_PACKAGES = [
  "workbox-window",
  "workbox-precaching",
  "workbox-routing",
  "workbox-strategies",
  "workbox-core",
  "workbox-expiration",
  "workbox-cacheable-response",
  "workbox-background-sync",
  "workbox-google-analytics",
  "workbox-navigation-preload",
  "workbox-range-requests",
  "workbox-streams",
  "workbox-sw",
  "workbox-webpack-plugin",
  "workbox-build",
  "workbox-cli",
  "vite-plugin-pwa",
  "@ducanh2912/next-pwa"
];

const SW_FILE_PATTERNS = [
  "service-worker",
  "serviceworker",
  "sw.js",
  "sw.ts",
  "sw.mjs",
  "sw.cjs"
];

export const ServiceWorkerPlugin: AnalyzerPlugin = {
  name: "service-worker-plugin",
  version: "1.2.0",

  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies
      };

      if (
        Object.keys(allDeps).some(
          (dep) => dep.startsWith("workbox-") || WORKBOX_PACKAGES.includes(dep)
        )
      ) {
        return true;
      }
    }

    // Check for common Service Worker files in root or public/
    return (
      (await adapter.folderExists("sw.js")) ||
      (await adapter.folderExists("sw.ts")) ||
      (await adapter.folderExists("service-worker.js")) ||
      (await adapter.folderExists("service-worker.ts")) ||
      (await adapter.folderExists("public/sw.js")) ||
      (await adapter.folderExists("public/service-worker.js"))
    );
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      const allDeps = {
        ...pkg?.dependencies,
        ...pkg?.devDependencies,
        ...pkg?.peerDependencies
      };

      // Protect installed Workbox and PWA packages in package.json
      for (const depName of Object.keys(allDeps)) {
        if (depName.startsWith("workbox-") || WORKBOX_PACKAGES.includes(depName)) {
          adapter.markPackageAsUsed(depName);
        }
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized).toLowerCase();

      // Mark Service Worker files as active entry points
      if (
        SW_FILE_PATTERNS.some(
          (pattern) => basename === pattern || basename.includes(pattern)
        )
      ) {
        adapter.markAsUsed(fileId);
      }
    },

    onASTNode: (node: any, fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized).toLowerCase();
      const isSwFile = SW_FILE_PATTERNS.some(
        (pattern) => basename === pattern || basename.includes(pattern)
      );

      // 1. Detect Workbox ESM imports in any file
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (source.startsWith("workbox-")) {
          adapter.markPackageAsUsed(source);
          adapter.markAsUsed(fileId);
        }
      }

      // 2. Detect navigator.serviceWorker.register('/sw.js') calls
      if (t.isCallExpression(node) && t.isMemberExpression(node.callee)) {
        const calleeProp = node.callee.property;
        const calleeObj = node.callee.object;

        if (
          t.isIdentifier(calleeProp) &&
          calleeProp.name === "register" &&
          t.isMemberExpression(calleeObj)
        ) {
          const innerObj = calleeObj.object;
          const innerProp = calleeObj.property;

          // Check if object expression resolves to navigator.serviceWorker
          if (
            t.isIdentifier(innerObj) &&
            innerObj.name === "navigator" &&
            t.isIdentifier(innerProp) &&
            innerProp.name === "serviceWorker"
          ) {
            adapter.markAsUsed(fileId);

            // Extract target script path argument: navigator.serviceWorker.register('/sw.js')
            const firstArg = node.arguments[0];
            if (t.isStringLiteral(firstArg)) {
              adapter.markAsUsed(firstArg.value);
            }
          }
        }
      }

      // 3. In Service Worker files, detect event listeners (e.g. self.addEventListener('install', ...))
      if (isSwFile) {
        if (
          t.isCallExpression(node) &&
          t.isMemberExpression(node.callee) &&
          t.isIdentifier(node.callee.property) &&
          node.callee.property.name === "addEventListener"
        ) {
          const firstArg = node.arguments[0];
          if (t.isStringLiteral(firstArg)) {
            const swEvents = new Set([
              "install",
              "activate",
              "fetch",
              "push",
              "notificationclick",
              "notificationclose",
              "sync",
              "periodicsync",
              "message"
            ]);

            if (swEvents.has(firstArg.value)) {
              adapter.markAsUsed(fileId);
            }
          }
        }
      }
    }
  }
};

export default ServiceWorkerPlugin;