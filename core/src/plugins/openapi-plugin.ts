import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const OPENAPI_FILES = ["openapi.yaml", "openapi.yml", "openapi.json"];

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

function schemaNamesFromSource(file: string, source: string): string[] {
  if (file.endsWith(".json")) {
    try {
      const document = JSON.parse(source);
      const schemas = document?.components?.schemas;
      return schemas && typeof schemas === "object" ? Object.keys(schemas) : [];
    } catch {
      return [];
    }
  }

  const names: string[] = [];
  let inSchemas = false;
  let schemasIndent = -1;
  for (const line of source.split(/\r?\n/)) {
    const match = /^(\s*)([^:#][^:]*):\s*$/.exec(line);
    if (!match) continue;
    const indent = match[1]?.length ?? 0;
    const key = match[2]?.trim();
    if (key === "schemas") {
      inSchemas = true;
      schemasIndent = indent;
      continue;
    }
    if (!inSchemas) continue;
    if (indent <= schemasIndent) {
      inSchemas = false;
      continue;
    }
    if (indent === schemasIndent + 2 && key) names.push(key);
  }
  return names;
}

function referencedSchemas(source: string): Set<string> {
  const references = new Set<string>();
  for (const match of source.matchAll(/#\/components\/schemas\/([^"'\s}]+)/g)) {
    const name = match[1];
    if (name) references.add(name);
  }
  return references;
}

function hasOpenApiTsDependency(pkg: Record<string, any> | null | undefined): boolean {
  const allDeps = {
    ...pkg?.dependencies,
    ...pkg?.devDependencies,
    ...pkg?.peerDependencies,
  };
  return Object.keys(allDeps).some(
    (dependency) =>
      dependency.startsWith("@hey-api/") ||
      dependency === "openapi-typescript" ||
      dependency === "openapi-fetch",
  );
}

function hasOpenApiTsScript(pkg: Record<string, any> | null | undefined): boolean {
  return Object.values(pkg?.scripts ?? {}).some(
    (script) =>
      typeof script === "string" &&
      (script.includes("openapi-ts") || script.includes("openapi-typescript")),
  );
}

export const OpenAPIPlugin: AnalyzerPlugin = {
  name: "openapi-plugin",
  version: "1.1.0",

  detect: async (adapter) => {
    const files = await adapter.findFiles(OPENAPI_FILES);
    if (files.length > 0) return true;

    const pkg = await adapter.readJson("package.json");
    if (hasOpenApiTsDependency(pkg) || hasOpenApiTsScript(pkg)) return true;

    for (const configFile of OPENAPI_TS_CONFIG_FILES) {
      if (await adapter.folderExists(configFile)) return true;
    }
    return false;
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const files = await adapter.findFiles(OPENAPI_FILES);
      const pkg = await adapter.readJson("package.json");
      const scriptUsesOpenAPI = hasOpenApiTsScript(pkg) || hasOpenApiTsDependency(pkg);

      // Protect OpenAPI documents and report schemas that are declared but unused.
      for (const file of files) {
        if (!scriptUsesOpenAPI && !file.includes("openapi/")) continue;
        adapter.markAsUsed(file);
        const source = await adapter.readFile(file);
        if (!source) continue;

        const referenced = referencedSchemas(source);
        const schemas = schemaNamesFromSource(file, source);
        for (const name of schemas) {
          if (referenced.has(name)) continue;
          adapter.emitFinding({
            rule: "unused-openapi-schema",
            severity: "warning",
            confidence: "high",
            file,
            message: `OpenAPI schema '${name}' is declared but never referenced.`,
            evidence: { schemaName: name },
          });
        }
      }

      // Protect OpenAPI TypeScript generator configuration files.
      let hasConfigFile = false;
      for (const configFile of OPENAPI_TS_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          hasConfigFile = true;
          adapter.markAsUsed(configFile);
        }
      }

      // Track generator scripts and their corresponding package.
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (
            typeof scriptContent !== "string" ||
            (!scriptContent.includes("openapi-ts") && !scriptContent.includes("openapi-typescript"))
          ) {
            continue;
          }

          adapter.markAsUsed("package.json", `scripts:${scriptName}`);
          if (scriptContent.includes("openapi-ts")) {
            adapter.markPackageAsUsed("@hey-api/openapi-ts");
          } else {
            adapter.markPackageAsUsed("openapi-typescript");
          }
        }
      }

      // Emit a missing dependency finding when a generator config exists without its tool.
      if (hasConfigFile && !hasOpenApiTsDependency(pkg)) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message:
            "OpenAPI TypeScript configuration found, but '@hey-api/openapi-ts' or 'openapi-typescript' is not listed in package.json.",
          evidence: { hasConfigFile },
        });
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      if (OPENAPI_FILES.some((name) => normalized.endsWith(`/openapi/${name}`))) {
        adapter.markAsUsed(fileId);
      }

      if (OPENAPI_TS_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("@hey-api/openapi-ts");
      }
    },

    onASTNode: (node: any, fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);
      const isConfigFile = OPENAPI_TS_CONFIG_FILES.includes(basename);

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

      if (!isConfigFile) return;

      if (t.isExportDefaultDeclaration(node)) {
        adapter.markAsUsed(fileId, "default");
        adapter.markPackageAsUsed("@hey-api/openapi-ts");
      }

      if (
        t.isCallExpression(node) &&
        t.isIdentifier(node.callee) &&
        node.callee.name === "defineConfig"
      ) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("@hey-api/openapi-ts");
      }

      if (t.isObjectProperty(node) && t.isIdentifier(node.key) && node.key.name === "output") {
        const value = node.value;
        if (t.isStringLiteral(value)) {
          adapter.markAsUsed(value.value);
        } else if (t.isObjectExpression(value)) {
          value.properties.forEach((property: any) => {
            if (
              t.isObjectProperty(property) &&
              t.isIdentifier(property.key) &&
              property.key.name === "path" &&
              t.isStringLiteral(property.value)
            ) {
              adapter.markAsUsed(property.value.value);
            }
          });
        }
      }

      if (t.isObjectProperty(node) && t.isIdentifier(node.key) && node.key.name === "client") {
        if (t.isStringLiteral(node.value)) {
          adapter.markPackageAsUsed(node.value.value);
        }
      }
    },
  },
};

export default OpenAPIPlugin;
