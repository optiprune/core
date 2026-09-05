import type { AnalyzerPlugin } from "../types.js";
import { packageIsDeclared, markDeclaredPackage } from "./package-plugin-utils.js";

export const OpenapiTsPlugin: AnalyzerPlugin = {
  name: "openapi-ts-plugin",
  version: "1.0.0",
  async detect(adapter) {
    return packageIsDeclared(await adapter.readJson("package.json"), "openapi-ts");
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      if (packageIsDeclared(pkg, "openapi-ts")) markDeclaredPackage(adapter, "openapi-ts");
    },
  },
};

export default OpenapiTsPlugin;
