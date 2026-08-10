import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

/**
 * Recognized React Email packages
 */
const REACT_EMAIL_CORE_PACKAGES = [
  "react-email",
  "@react-email/components",
  "@react-email/render",
  "@react-email/tailwind"
];

/**
 * Helper to check if a path corresponds to a React Email template directory
 */
function isReactEmailDirectory(normalizedPath: string): boolean {
  return (
    normalizedPath.includes("/emails/") ||
    normalizedPath.startsWith("emails/") ||
    normalizedPath.includes("/src/emails/") ||
    normalizedPath.startsWith("src/emails/")
  );
}

export const ReactEmailPlugin: AnalyzerPlugin = {
  name: "react-email-plugin",
  version: "1.0.0",

  detect: async (adapter) => {
    // 1. Check for dedicated emails folder
    if (
      (await adapter.folderExists("emails")) ||
      (await adapter.folderExists("src/emails"))
    ) {
      return true;
    }

    // 2. Check package.json for react-email or @react-email/* dependencies / scripts
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies
      };

      if (
        Object.keys(allDeps).some(
          (dep) => dep === "react-email" || dep.startsWith("@react-email/")
        )
      ) {
        return true;
      }

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (
          scriptValues.some(
            (s) =>
              typeof s === "string" &&
              (/\breact-email\b/.test(s) || s.includes("email dev"))
          )
        ) {
          return true;
        }
      }
    }

    return false;
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");

      // 1. Protect dedicated email directories
      if (await adapter.folderExists("emails")) {
        adapter.markAsUsed("emails");
      }
      if (await adapter.folderExists("src/emails")) {
        adapter.markAsUsed("src/emails");
      }

      if (pkg) {
        // 2. Protect react-email and all @react-email/* packages in package.json
        const allDeps = {
          ...pkg.dependencies,
          ...pkg.devDependencies,
          ...pkg.peerDependencies
        };

        for (const depName of Object.keys(allDeps)) {
          if (depName === "react-email" || depName.startsWith("@react-email/")) {
            adapter.markPackageAsUsed(depName);
          }
        }

        // 3. Mark npm scripts calling react-email CLI as used
        if (pkg.scripts) {
          for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
            if (
              typeof scriptContent === "string" &&
              (/\breact-email\b/.test(scriptContent) || scriptContent.includes("email dev"))
            ) {
              adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            }
          }
        }
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");

      // Protect template files inside emails/ or src/emails/
      if (isReactEmailDirectory(normalized)) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("react-email");
      }
    },

    onASTNode: (node: any, fileId: string, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");

      // 1. Inspect email templates inside emails/ for export default EmailComponent
      if (isReactEmailDirectory(normalized)) {
        if (
          t.isExportDefaultDeclaration(node) ||
          t.isExportNamedDeclaration(node)
        ) {
          adapter.markAsUsed(fileId);
          adapter.markPackageAsUsed("react-email");
        }
      }

      // 2. Detect render() function call from @react-email/render
      if (
        t.isCallExpression(node) &&
        t.isIdentifier(node.callee) &&
        node.callee.name === "render"
      ) {
        adapter.markAsUsed(fileId);
      }

      // 3. Retain imports from react-email or @react-email/*
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (source === "react-email" || source.startsWith("@react-email/")) {
          adapter.markPackageAsUsed(source);
          adapter.markAsUsed(fileId);
        }
      }
    }
  }
};

export default ReactEmailPlugin;