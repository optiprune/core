import type { AnalyzerPlugin } from "../types.js";
import { packageIsDeclared, markDeclaredPackage } from "./package-plugin-utils.js";

export const KnexInlinePlugin: AnalyzerPlugin = {
  name: "knex-inline-plugin",
  version: "1.0.0",
  async detect(adapter) {
    return packageIsDeclared(await adapter.readJson("package.json"), "knex-inline");
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      if (packageIsDeclared(pkg, "knex-inline")) markDeclaredPackage(adapter, "knex-inline");
    },
  },
};

export default KnexInlinePlugin;
