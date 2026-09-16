import type { AnalyzerPlugin } from "../types.js";

const OPENAPI_FILES = ["openapi.yaml", "openapi.yml", "openapi.json"];

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

export const OpenAPIPlugin: AnalyzerPlugin = {
  name: "openapi-plugin",
  version: "1.0.1",

  detect: async (adapter) => {
    const files = await adapter.findFiles(OPENAPI_FILES);
    if (files.length > 0) return true;
    const pkg = await adapter.readJson("package.json");
    return Object.values(pkg?.scripts ?? {}).some(
      (script) => typeof script === "string" && /openapi/i.test(script),
    );
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const files = await adapter.findFiles(OPENAPI_FILES);
      const pkg = await adapter.readJson("package.json");
      const scriptUsesOpenAPI = Object.values(pkg?.scripts ?? {}).some(
        (script) => typeof script === "string" && /openapi/i.test(script),
      );

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
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      if (OPENAPI_FILES.some((name) => normalized.endsWith(`/openapi/${name}`))) {
        adapter.markAsUsed(fileId);
      }
    },
  },
};

export default OpenAPIPlugin;
