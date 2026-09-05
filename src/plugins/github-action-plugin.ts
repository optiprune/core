import type { AnalyzerPlugin } from "../types.js";
import { packageIsDeclared, markDeclaredPackage } from "./package-plugin-utils.js";

export const GithubActionPlugin: AnalyzerPlugin = {
  name: "github-action-plugin",
  version: "1.0.0",
  async detect(adapter) {
    return packageIsDeclared(await adapter.readJson("package.json"), "github-action");
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      if (packageIsDeclared(pkg, "github-action")) markDeclaredPackage(adapter, "github-action");
    },
  },
};

export default GithubActionPlugin;
