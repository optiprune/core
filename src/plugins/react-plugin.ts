import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const REACT_PACKAGES = [
  "react",
  "react-dom",
  "react-router",
  "react-router-dom",
  "react-is",
  "@types/react",
  "@types/react-dom"
];

const REACT_HOC_NAMES = new Set([
  "memo",
  "forwardRef",
  "lazy",
  "connect",
  "withRouter"
]);

export const ReactPlugin: AnalyzerPlugin = {
  name: "react-plugin",
  version: "1.3.1",

  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies
      };
      if (REACT_PACKAGES.some((pkgName) => pkgName in allDeps)) {
        return true;
      }
    }

    // JSX/TSX only expresses syntax support. It is shared by React, Next.js,
    // Preact, Solid, and custom JSX runtimes, so it is not framework evidence.
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

      const hasReactDep = REACT_PACKAGES.some((p) => p in allDeps);

      // Safeguard installed React ecosystem packages in package.json
      if (hasReactDep) {
        adapter.declareFramework("react");
        // Do not treat a manifest entry as usage evidence.
      }

      const config =
        (await adapter.readJson("tsconfig.json")) ||
        (await adapter.readJson("jsconfig.json"));

      if (config?.compilerOptions?.jsx && !hasReactDep) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "warning",
          confidence: "medium",
          file: "package.json",
          message:
            "JSX support is enabled in tsconfig/jsconfig, but 'react' is not listed in package.json dependencies.",
          evidence: { jsxEnabled: true }
        });
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Mark React component file conventions (.jsx, .tsx)
      if (basename.endsWith(".jsx") || basename.endsWith(".tsx")) {
        adapter.markPackageAsUsed("react");
      }
    },

    onASTNode: (node: any, fileId, adapter) => {
      // 1. React Server Component / Action Directives ('use client', 'use server')
      if (
        !adapter.hasFramework("nextjs") &&
        node?.type === "ExpressionStatement" &&
        t.isStringLiteral(node.expression) &&
        ["use client", "use server"].includes(node.expression.value)
      ) {
        // React syntax identifies React usage, not file reachability.
        adapter.markPackageAsUsed("react");
      }

      // 2. ESM & CJS Import Detection for React
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (
          REACT_PACKAGES.includes(source) ||
          source.startsWith("react-") ||
          source.startsWith("@types/react")
        ) {
          adapter.markPackageAsUsed(source);
        }
      }

      let targetNode = node;

      // Unwrap export declarations safely
      if (
        (node?.type === "ExportNamedDeclaration" || node?.type === "ExportDefaultDeclaration") &&
        node.declaration
      ) {
        targetNode = node.declaration;
      }

      // 3. Exported Function Components: export function MyComponent() {}
      if (
        !adapter.hasFramework("nextjs") &&
        t.isFunctionDeclaration(targetNode) &&
        targetNode.id &&
        /^[A-Z]/.test(targetNode.id.name)
      ) {
        if (node.type === "ExportNamedDeclaration" || node.type === "ExportDefaultDeclaration") {
          adapter.markPackageAsUsed("react");
        }
      }

      // 4. Exported Variable Components & HOC Wrappers: const Button = React.memo(...)
      if (
        !adapter.hasFramework("nextjs") &&
        t.isVariableDeclaration(targetNode) &&
        Array.isArray(targetNode.declarations)
      ) {
        for (const decl of targetNode.declarations) {
          if (t.isIdentifier(decl.id) && /^[A-Z]/.test(decl.id.name)) {
            const init = decl.init;
            if (!init) continue;

            const isStandardComponent =
              t.isArrowFunctionExpression(init) ||
              t.isFunctionExpression(init) ||
              t.isJSXElement(init);

            // Check if wrapped in React HOC like memo, forwardRef, lazy
            let isHocComponent = false;
            if (t.isCallExpression(init)) {
              const callee = init.callee;
              if (t.isIdentifier(callee) && REACT_HOC_NAMES.has(callee.name)) {
                isHocComponent = true;
              } else if (
                t.isMemberExpression(callee) &&
                t.isIdentifier(callee.property) &&
                REACT_HOC_NAMES.has(callee.property.name)
              ) {
                isHocComponent = true;
              }
            }

            if (
              (isStandardComponent || isHocComponent) &&
              (node.type === "ExportNamedDeclaration" || node.type === "ExportDefaultDeclaration")
            ) {
              adapter.markPackageAsUsed("react");
            }
          }
        }
      }

      // 5. Hooks: useFoo() call expressions or custom hook declarations
      if (
        !adapter.hasFramework("nextjs") &&
        t.isCallExpression(node) &&
        t.isIdentifier(node.callee) &&
        node.callee.name.startsWith("use") &&
        node.callee.name.length > 3
      ) {
        // React syntax identifies React usage, not file reachability.
        adapter.markPackageAsUsed("react");
      }

      // 6. JSX Components (<MyComponent />, <Form.Item />)
      if (!adapter.hasFramework("nextjs") && t.isJSXElement(node) && node.openingElement) {
        const elementName = node.openingElement.name;

        // Standard Identifier: <Button />
        if (t.isJSXIdentifier(elementName)) {
          const compName = elementName.name;
          if (compName && compName.charAt(0) === compName.charAt(0).toUpperCase()) {
            adapter.markPackageAsUsed("react");
          }
        }

        // Namespaced Member Expression: <Form.Item /> or <UI.Button />
        if (elementName?.type === "JSXMemberExpression") {
          let object = elementName.object;
          while (object?.type === "JSXMemberExpression") {
            object = object.object;
          }
          if (t.isJSXIdentifier(object) && object.name) {
            adapter.markPackageAsUsed("react");
          }
        }
      }
    }
  }
};

export default ReactPlugin;