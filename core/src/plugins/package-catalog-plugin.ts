import type { AnalyzerPlugin } from "../types.js";

const CATALOG_FILES = ["pnpm-workspace.yaml", ".yarnrc.yml", ".yarnrc"];

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
      if (await adapter.folderExists(file)) return true;
    }
    return false;
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      for (const file of CATALOG_FILES) {
        if (await adapter.folderExists(file)) adapter.markAsUsed(file);
      }
    },
    onFileStart: (fileId, adapter) => {
      if (CATALOG_FILES.some((catalogFile) => fileId.endsWith(catalogFile))) {
        adapter.markAsUsed(fileId);
      }
    },
  },
};

export default PackageCatalogPlugin;
