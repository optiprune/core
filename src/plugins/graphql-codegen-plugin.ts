import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const CODEGEN_CONFIG_FILES = [
  "codegen.ts",
  "codegen.js",
  "codegen.mjs",
  "codegen.cjs",
  "codegen.yml",
  "codegen.yaml",
  "codegen.json",
];

const CODEGEN_PACKAGES = [
  "@graphql-codegen/cli",
  "@graphql-codegen/typescript",
  "@graphql-codegen/typescript-operations",
  "@graphql-codegen/typescript-react-apollo",
  "@graphql-codegen/typescript-vue-apollo",
  "@graphql-codegen/typescript-urql",
  "@graphql-codegen/typescript-resolvers",
  "@graphql-codegen/client-preset",
  "@graphql-codegen/schema-ast",
  "@graphql-codegen/fragment-matcher",
  "@graphql-codegen/introspection",
  "graphql",
];

export const GraphQLCodegenPlugin: AnalyzerPlugin = {
  name: "graphql-codegen-plugin",
  version: "1.0.0",

  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies,
      };

      if (
        Object.keys(allDeps).some(
          (dep) => dep === "@graphql-codegen/cli" || dep.startsWith("@graphql-codegen/"),
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
              (s.includes("graphql-codegen") || s.includes("graphql-coder")),
          )
        ) {
          return true;
        }
      }
    }

    for (const configFile of CODEGEN_CONFIG_FILES) {
      if (await adapter.folderExists(configFile)) return true;
    }

    return false;
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      const allDeps = {
        ...pkg?.dependencies,
        ...pkg?.devDependencies,
        ...pkg?.peerDependencies,
      };

      const hasCodegen = Object.keys(allDeps).some(
        (p) => p === "@graphql-codegen/cli" || p.startsWith("@graphql-codegen/"),
      );

      // 1. Safeguard installed @graphql-codegen/* packages in package.json
      if (hasCodegen) {
        for (const depName of Object.keys(allDeps)) {
          if (depName === "graphql" || depName.startsWith("@graphql-codegen/")) {
            // A manifest entry alone is not evidence that this package is used.
            // Usage is marked by the config, script, import, or file hooks below.
          }
        }
      }

      // 2. Protect standalone config files
      let hasConfigFile = false;
      for (const configFile of CODEGEN_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          hasConfigFile = true;
          adapter.markAsUsed(configFile);
        }
      }

      // An active Code Generator configuration requires the GraphQL runtime.
      if (hasConfigFile && hasCodegen && allDeps.graphql) {
        adapter.markPackageAsUsed("graphql");
      }

      // 3. Track npm scripts invoking graphql-codegen CLI
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (typeof scriptContent === "string" && scriptContent.includes("graphql-codegen")) {
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            adapter.markPackageAsUsed("@graphql-codegen/cli");
          }
        }
      }

      // 4. Report missing dependency if config exists without @graphql-codegen/cli
      if (hasConfigFile && !hasCodegen) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message:
            "GraphQL Code Generator configuration file found, but '@graphql-codegen/cli' is not listed in package.json.",
          evidence: { hasConfigFile },
        });
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Protect configuration files
      if (CODEGEN_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("@graphql-codegen/cli");
      }
    },

    onASTNode: (node: any, fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);
      const isConfigFile = CODEGEN_CONFIG_FILES.includes(basename);

      // 1. Detect ESM imports for @graphql-codegen/* packages
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (source.startsWith("@graphql-codegen/") || source === "graphql") {
          adapter.markPackageAsUsed(source);
          adapter.markAsUsed(fileId);
        }
      }

      // 2. In GraphQL Codegen configuration files (codegen.ts / codegen.js)
      if (isConfigFile) {
        if (t.isExportDefaultDeclaration(node)) {
          adapter.markAsUsed(fileId, "default");
          adapter.markPackageAsUsed("@graphql-codegen/cli");
        }

        // Detect CJS module.exports = config
        if (
          node?.type === "AssignmentExpression" &&
          node.left?.type === "MemberExpression" &&
          node.left?.object?.name === "module" &&
          node.left?.property?.name === "exports"
        ) {
          adapter.markAsUsed(fileId);
          adapter.markPackageAsUsed("@graphql-codegen/cli");
        }

        // Extract plugins and presets inside generates map keys or plugin arrays
        if (t.isObjectProperty(node) && t.isIdentifier(node.key) && node.key.name === "generates") {
          if (t.isObjectExpression(node.value)) {
            node.value.properties.forEach((targetProp: any) => {
              // Extract target generated file path (e.g. 'src/gql/': { preset: 'client' })
              if (targetProp.key) {
                const targetFilePath = targetProp.key.value || targetProp.key.name;
                if (typeof targetFilePath === "string") {
                  adapter.markAsUsed(targetFilePath);

                  // A `generates` target is owned by GraphQL Code Generator.
                  // Its generated API may be consumed by generated documents or
                  // runtime tooling outside the static import graph.
                  const protectedPattern = targetFilePath.endsWith("/")
                    ? `${targetFilePath}**/*`
                    : targetFilePath;
                  adapter.addProtectedExportPatterns([protectedPattern]);
                }
              }

              // Inspect inner plugins / preset
              if (t.isObjectExpression(targetProp.value)) {
                targetProp.value.properties.forEach((innerProp: any) => {
                  if (!t.isIdentifier(innerProp.key)) return;

                  // Extract preset: 'client' -> @graphql-codegen/client-preset
                  if (innerProp.key.name === "preset" && t.isStringLiteral(innerProp.value)) {
                    const presetName = innerProp.value.value;
                    const fullPkg = presetName.startsWith("@")
                      ? presetName
                      : `@graphql-codegen/${presetName}-preset`;
                    adapter.markPackageAsUsed(fullPkg);
                  }

                  // Extract plugins: ['typescript', 'typescript-operations']
                  if (innerProp.key.name === "plugins" && t.isArrayExpression(innerProp.value)) {
                    innerProp.value.elements.forEach((pluginEl: any) => {
                      let pluginName: string | null = null;
                      if (t.isStringLiteral(pluginEl)) {
                        pluginName = pluginEl.value;
                      } else if (t.isObjectExpression(pluginEl)) {
                        const firstKey = pluginEl.properties[0]?.key;
                        if (firstKey) {
                          pluginName = firstKey.value || firstKey.name;
                        }
                      }

                      if (pluginName) {
                        const fullPkg = pluginName.startsWith("@")
                          ? pluginName
                          : `@graphql-codegen/${pluginName}`;
                        adapter.markPackageAsUsed(fullPkg);
                      }
                    });
                  }
                });
              }
            });
          }
        }
      }
    },
  },
};

export default GraphQLCodegenPlugin;
