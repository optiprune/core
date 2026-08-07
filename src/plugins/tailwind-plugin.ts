import { AnalyzerPlugin } from "../types.js";
import path from "pathe";

const TAILWIND_FILES = ["tailwind.config.js", "tailwind.config.ts", "tailwind.config.cjs", "tailwind.config.mjs"];

export const TailwindPlugin: AnalyzerPlugin = {
  name: "tailwind-plugin",
  version: "1.1.0",
  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (pkg?.devDependencies?.["tailwindcss"] || pkg?.dependencies?.["tailwindcss"]) {
      return true;
    }
    for (const file of TAILWIND_FILES) {
      if (await adapter.readFile(file) !== null) return true;
    }
    return false;
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      const hasTailwindDep = pkg ? !!(pkg.dependencies?.["tailwindcss"] || pkg.devDependencies?.["tailwindcss"]) : false;
      
      let hasConfigFile = false;
      for (const file of TAILWIND_FILES) {
        if (await adapter.readFile(file) !== null) {
          hasConfigFile = true;
          break;
        }
      }

      if (hasConfigFile && !hasTailwindDep) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message: "Tailwind configuration found but 'tailwindcss' is not listed in package.json.",
          evidence: { hasConfigFile }
        });
      }
    },
    onFileStart: (fileId, adapter) => {
      if (TAILWIND_FILES.some(pattern => fileId.endsWith(pattern))) {
        adapter.markAsUsed(fileId);
      }
    },
    onASTNode: (node, fileId, adapter) => {
      const fileName = path.basename(fileId);
      if (TAILWIND_FILES.some(pattern => fileName === pattern)) {
        if (node.type === "ExportDefaultDeclaration") {
          adapter.markAsUsed(fileId, "default");
        }
        // Support for module.exports
        if (
          node.type === "AssignmentExpression" &&
          node.left?.type === "MemberExpression" &&
          node.left.object?.name === "module" &&
          node.left.property?.name === "exports"
        ) {
          adapter.markAsUsed(fileId);
        }

        // Detect plugins in tailwind.config.js
        if (node.type === "Property" || node.type === "ObjectProperty") {
          const keyName = (node.key as any).name || (node.key as any).value;
          if (keyName === "plugins" && node.value.type === "ArrayExpression") {
            node.value.elements.forEach((el: any) => {
              if (el.type === "CallExpression") {
                // e.g., require('@tailwindcss/typography')
                if (el.callee.name === "require" && el.arguments[0]?.type === "Literal") {
                  adapter.markAsUsed(el.arguments[0].value);
                }
              } else if (el.type === "Literal" && typeof el.value === "string") {
                adapter.markAsUsed(el.value);
              }
            });
          }
          
          // Detect content/purge paths
          if ((keyName === "content" || keyName === "purge") && node.value.type === "ArrayExpression") {
            node.value.elements.forEach((el: any) => {
              if (el.type === "Literal" && typeof el.value === "string") {
                // Tailwind glob patterns are not direct file references, but we can mark them as info
              }
            });
          }
        }
      }
    }
  }
};

export default TailwindPlugin;
