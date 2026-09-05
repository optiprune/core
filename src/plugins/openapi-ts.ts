import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const OPENAPI_TS_CONFIG_FILES = [
  "openapi-ts.config.ts",
  "openapi-ts.config.js",
  "openapi-ts.config.mjs",
  "openapi-ts.config.cjs",
  "openapi-ts.config.mts",
  "openapi-ts.config.cts",
  ".openapitsrc",
  ".openapitsrc.json",
  ".openapitsrc.js",
];

const OPENAPI_TS_PACKAGES = [
  "@hey-api/openapi-ts",
  "@hey-api/client-fetch",
  "@hey-api/client-axios",
  "@hey-api/client-nuxt",
  "openapi-typescript",
  "openapi-fetch",
];

export const OpenApiTsPlugin: AnalyzerPlugin = {
  name: "openapi-ts-plugin",
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
          (dep) =>
            dep.startsWith("@hey-api/") || dep === "openapi-typescript" || dep === "openapi-fetch",
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
              (s.includes("openapi-ts") || s.includes("openapi-typescript")),
          )
        ) {
          return true;
        }
      }
    }

    for (const configFile of OPENAPI_TS_CONFIG_FILES) {
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

      const hasOpenApiTs = Object.keys(allDeps).some(
        (p) => p.startsWith("@hey-api/") || p === "openapi-typescript" || p === "openapi-fetch",
      );

      // 1. Safeguard installed OpenAPI-TS packages in package.json
      if (hasOpenApiTs) {
        for (const depName of OPENAPI_TS_PACKAGES) {
          if (allDeps[depName]) {
            // A manifest entry alone is not evidence that this package is used.
            // Usage is marked by the config, script, import, or file hooks below.
          }
        }
      }

      // 2. Protect standalone configuration files
      let hasConfigFile = false;
      for (const configFile of OPENAPI_TS_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          hasConfigFile = true;
          adapter.markConfigFileAsUsed(configFile);
        }
      }

      // 3. Track npm scripts invoking CLI (e.g., "generate": "openapi-ts")
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (
            typeof scriptContent === "string" &&
            (scriptContent.includes("openapi-ts") || scriptContent.includes("openapi-typescript"))
          ) {
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            if (scriptContent.includes("openapi-ts")) {
              adapter.markPackageAsUsed("@hey-api/openapi-ts");
            } else {
              adapter.markPackageAsUsed("openapi-typescript");
            }
          }
        }
      }

      // 4. Emit finding if config file is present but CLI package is missing
      if (hasConfigFile && !hasOpenApiTs) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message:
            "OpenAPI-TS configuration found, but '@hey-api/openapi-ts' or 'openapi-typescript' is not listed in package.json.",
          evidence: { hasConfigFile },
        });
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Protect configuration files
      if (OPENAPI_TS_CONFIG_FILES.includes(basename)) {
        adapter.markConfigFileAsUsed(fileId);
        adapter.markPackageAsUsed("@hey-api/openapi-ts");
      }
    },

    onASTNode: (node: any, fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);
      const isConfigFile = OPENAPI_TS_CONFIG_FILES.includes(basename);

      // 1. Detect ESM imports for @hey-api/* or openapi-typescript
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (
          source.startsWith("@hey-api/") ||
          source === "openapi-typescript" ||
          source === "openapi-fetch"
        ) {
          adapter.markPackageAsUsed(source);
          adapter.markAsUsed(fileId);
        }
      }

      // 2. In OpenAPI-TS config files (openapi-ts.config.ts)
      if (isConfigFile) {
        if (t.isExportDefaultDeclaration(node)) {
          adapter.markAsUsed(fileId, "default");
          adapter.markPackageAsUsed("@hey-api/openapi-ts");
        }

        // Detect defineConfig(...) call expression
        if (
          t.isCallExpression(node) &&
          t.isIdentifier(node.callee) &&
          node.callee.name === "defineConfig"
        ) {
          adapter.markAsUsed(fileId);
          adapter.markPackageAsUsed("@hey-api/openapi-ts");
        }

        // Extract output directory / file target in config: output: 'src/client' or output: { path: 'src/client' }
        if (t.isObjectProperty(node) && t.isIdentifier(node.key) && node.key.name === "output") {
          const val = node.value;
          if (t.isStringLiteral(val)) {
            adapter.markAsUsed(val.value);
          } else if (t.isObjectExpression(val)) {
            val.properties.forEach((prop: any) => {
              if (
                t.isObjectProperty(prop) &&
                t.isIdentifier(prop.key) &&
                prop.key.name === "path" &&
                t.isStringLiteral(prop.value)
              ) {
                adapter.markAsUsed(prop.value.value);
              }
            });
          }
        }

        // Extract client plugin choice: client: '@hey-api/client-fetch'
        if (t.isObjectProperty(node) && t.isIdentifier(node.key) && node.key.name === "client") {
          if (t.isStringLiteral(node.value)) {
            adapter.markPackageAsUsed(node.value.value);
          }
        }
      }
    },
  },
};

export default OpenApiTsPlugin;
