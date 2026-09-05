import type { AnalyzerPlugin } from "../types.js";
import { packageIsDeclared, markDeclaredPackage } from "./package-plugin-utils.js";

export const MetroReactNativePlugin: AnalyzerPlugin = {
  name: "metro-react-native-plugin",
  version: "1.0.0",
  async detect(adapter) {
    return packageIsDeclared(await adapter.readJson("package.json"), "metro-react-native");
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      if (packageIsDeclared(pkg, "metro-react-native"))
        markDeclaredPackage(adapter, "metro-react-native");
    },
  },
};

export default MetroReactNativePlugin;
