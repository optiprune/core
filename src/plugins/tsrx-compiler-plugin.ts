import type { AnalyzerPlugin } from "../types.js";

export const TsRxCompilerPlugin: AnalyzerPlugin = {
  name: "tsrx-compiler-plugin",
  version: "1.0.0",
  detect: async (adapter) => (await adapter.findFilesByGlob(["**/*.tsrx"])).length > 0,
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      const dependencies = { ...pkg?.dependencies, ...pkg?.devDependencies, ...pkg?.peerDependencies };
      if (dependencies["@tsrx/react"]) adapter.markPackageAsUsed("@tsrx/react");
    },
  },
};

export default TsRxCompilerPlugin;
