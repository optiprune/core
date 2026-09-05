import type { AnalyzerPlugin } from "../types.js";
import { packageIsDeclared, markDeclaredPackage } from "./package-plugin-utils.js";

export const GraphqlCodegenGraphqlConfigPlugin: AnalyzerPlugin = {
  name: "graphql-codegen-graphql-config-plugin",
  version: "1.0.0",
  async detect(adapter) {
    return packageIsDeclared(
      await adapter.readJson("package.json"),
      "graphql-codegen-graphql-config",
    );
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      if (packageIsDeclared(pkg, "graphql-codegen-graphql-config"))
        markDeclaredPackage(adapter, "graphql-codegen-graphql-config");
    },
  },
};

export default GraphqlCodegenGraphqlConfigPlugin;
