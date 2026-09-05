import path from "pathe";
import type { AnalyzerPlugin, CompilerDefinition } from "./types.js";

const BUILTIN_COMPILER_PACKAGES: Record<string, string[]> = {
  ".less": ["less"],
  ".scss": ["sass"],
  ".sass": ["sass"],
  ".styl": ["stylus"],
  ".stylus": ["stylus"],
  ".prisma": ["prisma", "@prisma/client"],
  ".marko": ["@marko-js/marko", "marko"],
  ".tsrx": ["tsrx"],
};

function extension(file: string): string {
  const normalized = file.replace(/\\/g, "/").toLowerCase();
  return path.extname(normalized);
}

function compilerDependencies(definition: CompilerDefinition | undefined): string[] {
  if (!definition) return [];
  if (typeof definition === "function") return [];
  return Array.isArray(definition.dependencies)
    ? definition.dependencies.filter(
        (dependency): dependency is string => typeof dependency === "string",
      )
    : [];
}

export const CompilerPlugin: AnalyzerPlugin = {
  name: "compiler-plugin",
  version: "1.0.0",
  async detect(adapter) {
    const configured = Object.keys(adapter.getConfig().compilers ?? {});
    if (configured.length > 0) return true;
    const files = await adapter.findFilesByGlob([
      "**/*.less",
      "**/*.scss",
      "**/*.sass",
      "**/*.styl",
      "**/*.stylus",
      "**/*.prisma",
      "**/*.marko",
      "**/*.tsrx",
      "**/tailwind.config.*",
    ]);
    return files.length > 0;
  },
  lifecycle: {
    async onProjectInit(adapter) {
      const config = adapter.getConfig();
      const configured = config.compilers ?? {};
      const patterns = new Set<string>([
        ...Object.keys(BUILTIN_COMPILER_PACKAGES).map((ext) => `**/*${ext}`),
        ...Object.keys(configured).map((ext) => `**/*${ext.startsWith(".") ? ext : `.${ext}`}`),
        "**/tailwind.config.*",
      ]);
      const files = await adapter.findFilesByGlob([...patterns]);
      for (const file of files) {
        const ext = extension(file);
        const packages = new Set(BUILTIN_COMPILER_PACKAGES[ext] ?? []);
        if (/\/tailwind\.config\.[^/]+$/i.test(file.replace(/\\/g, "/"))) {
          packages.add("tailwindcss");
        }
        const definition = configured[ext] ?? configured[ext.slice(1)];
        for (const dependency of compilerDependencies(definition as CompilerDefinition)) {
          packages.add(dependency);
        }
        for (const dependency of packages) adapter.markPackageAsUsed(dependency);
        adapter.markAsUsed(file);

        if (typeof definition === "function") {
          try {
            const result = await definition((await adapter.readFile(file)) ?? "", file);
            if (typeof result === "object" && result && Array.isArray(result.dependencies)) {
              for (const dependency of result.dependencies) {
                if (typeof dependency === "string") {
                  if (dependency.startsWith(".") || dependency.startsWith("/")) {
                    adapter.markRelativeFileAsUsed(file, dependency);
                  } else {
                    adapter.markPackageAsUsed(dependency);
                  }
                }
              }
            }
          } catch {
            // A user compiler is advisory; parser and graph analysis continue.
          }
        } else if (definition?.compile) {
          try {
            const result = await definition.compile((await adapter.readFile(file)) ?? "", file);
            if (typeof result === "object" && result && Array.isArray(result.dependencies)) {
              for (const dependency of result.dependencies) {
                if (typeof dependency === "string") {
                  if (dependency.startsWith(".") || dependency.startsWith("/")) {
                    adapter.markRelativeFileAsUsed(file, dependency);
                  } else {
                    adapter.markPackageAsUsed(dependency);
                  }
                }
              }
            }
          } catch {
            // See the function form above.
          }
        }
      }
    },
  },
};

export default CompilerPlugin;
