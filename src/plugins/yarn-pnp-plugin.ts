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
    if (await adapter.folderExists(".pnp.loader.mjs")) return true;
    for (const config of [".yarnrc.yml", ".yarnrc"]) {
      const content = await adapter.readFile(config);
      if (typeof content === "string" && /nodeLinker\s*:\s*pnp\b/.test(content)) return true;
    }
    return false;
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      for (const metadataPath of PNP_METADATA) {
        if (await adapter.folderExists(metadataPath)) adapter.markConfigFileAsUsed(metadataPath);
      }
      adapter.setRepoType("workspace");
    },
    onFileStart: (fileId, adapter) => {
      if (PNP_METADATA.some((metadataPath) => fileId.endsWith(metadataPath))) {
        adapter.markConfigFileAsUsed(fileId);
      }
    },
  },
};

export default YarnPnpPlugin;
