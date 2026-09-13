import type { AnalyzerPlugin, PluginAdapter } from "../types.js";

const CATALOG_FILES = ["pnpm-workspace.yaml", ".yarnrc.yml", ".yarnrc"];

async function hasCatalog(adapter: PluginAdapter, file: string): Promise<boolean> {
  const content = await adapter.readFile(file);
  return typeof content === "string" && /(^|\n)\s*catalogs?\s*:/m.test(content);
}

/**
 * Makes package-manager catalog metadata first-class analysis input. The
 * dependency audit handles references in manifests and scripts; this plugin
 * ensures the catalog declaration itself is retained and visible to users.
 */
export const PackageCatalogPlugin: AnalyzerPlugin = {
  name: "package-catalog-plugin",
  version: "1.0.0",
  detect: async (adapter) => {
    for (const file of CATALOG_FILES) {
      if ((await adapter.folderExists(file)) && (await hasCatalog(adapter, file))) return true;
    }
    return false;
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      for (const file of CATALOG_FILES) {
        if ((await adapter.folderExists(file)) && (await hasCatalog(adapter, file))) {
          adapter.markConfigFileAsUsed(file);
        }
      }
    },
    onFileStart: (fileId, adapter) => {
      if (CATALOG_FILES.some((catalogFile) => fileId.endsWith(catalogFile))) {
        adapter.markConfigFileAsUsed(fileId);
      }
    },
  },
};

export default PackageCatalogPlugin;
