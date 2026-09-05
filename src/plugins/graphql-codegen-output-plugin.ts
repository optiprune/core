import type { AnalyzerPlugin } from "../types.js";
import { packageIsDeclared, markDeclaredPackage } from "./package-plugin-utils.js";

export const GraphqlCodegenOutputPlugin: AnalyzerPlugin = {
  name: "graphql-codegen-output-plugin",
  version: "1.0.0",
  async detect(adapter) {
    return packageIsDeclared(await adapter.readJson("package.json"), "graphql-codegen-output");
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      if (packageIsDeclared(pkg, "graphql-codegen-output"))
        markDeclaredPackage(adapter, "graphql-codegen-output");
    },
  },
};

export default GraphqlCodegenOutputPlugin;
