import type { AnalyzerPlugin } from "../types.js";

const PNP_METADATA = [".pnp.cjs", ".pnp.loader.mjs", ".yarnrc.yml", ".yarnrc"];

/**
 * Recognizes Yarn Plug'n'Play projects while deliberately treating `.pnp.cjs`
 * as data. Resolution of filesystem-visible unplugged manifests is performed
 * by Layer 6; the plugin only establishes the package-manager contract and
 * protects the metadata files that define it.
 */
export const YarnPnpPlugin: AnalyzerPlugin = {
  name: "yarn-pnp-plugin",
  version: "1.0.0",
  detect: async (adapter) => {
    if (await adapter.folderExists(".pnp.cjs")) return true;
    const packageJson = await adapter.readJson("package.json");
    return (
      typeof packageJson?.packageManager === "string" &&
      packageJson.packageManager.startsWith("yarn@")
    );
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      for (const metadataPath of PNP_METADATA) {
        if (await adapter.folderExists(metadataPath)) adapter.markAsUsed(metadataPath);
      }
      adapter.setRepoType("workspace");
    },
    onFileStart: (fileId, adapter) => {
      if (PNP_METADATA.some((metadataPath) => fileId.endsWith(metadataPath))) {
        adapter.markAsUsed(fileId);
      }
    },
  },
};

export default YarnPnpPlugin;
