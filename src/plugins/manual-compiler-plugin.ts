import type { AnalyzerPlugin, CompilerDefinition } from "../types.js";

function dependenciesOf(definition: CompilerDefinition | undefined): string[] {
  if (!definition || typeof definition === "function") return [];
  return Array.isArray(definition.dependencies)
    ? definition.dependencies.filter((value): value is string => typeof value === "string")
    : [];
}

async function consumeResult(
  adapter: Parameters<NonNullable<AnalyzerPlugin["lifecycle"]["onProjectInit"]>>[0],
  sourceFile: string,
  result: unknown,
): Promise<void> {
  if (!result || typeof result !== "object" || !Array.isArray((result as any).dependencies)) return;
  for (const dependency of (result as any).dependencies) {
    if (typeof dependency !== "string") continue;
    if (dependency.startsWith(".") || dependency.startsWith("/")) {
      adapter.markRelativeFileAsUsed(sourceFile, dependency);
    } else {
      adapter.markPackageAsUsed(dependency);
    }
  }
}

export const ManualCompilerPlugin: AnalyzerPlugin = {
  name: "manual-compiler-plugin",
  version: "1.0.0",
  detect: async (adapter) => Object.keys(adapter.getConfig().compilers ?? {}).length > 0,
  lifecycle: {
    async onProjectInit(adapter) {
      const configured = adapter.getConfig().compilers ?? {};
      for (const [rawExtension, definition] of Object.entries(configured)) {
        const extension = rawExtension.startsWith(".") ? rawExtension : `.${rawExtension}`;
        const files = await adapter.findFilesByGlob([`**/*${extension}`]);
        for (const file of files) {
          adapter.markAsUsed(file);
          for (const packageName of dependenciesOf(definition))
            adapter.markPackageAsUsed(packageName);
          try {
            const source = (await adapter.readFile(file)) ?? "";
            const result =
              typeof definition === "function"
                ? await definition(source, file)
                : definition.compile
                  ? await definition.compile(source, file)
                  : undefined;
            await consumeResult(adapter, file, result);
          } catch {
            // User compilers are advisory; normal graph analysis still proceeds.
          }
        }
      }
    },
  },
};

export default ManualCompilerPlugin;
