import type { AnalyzerPlugin } from "../types.js";
import { markCompilerFiles } from "./compiler-utils.js";

export const StylusCompilerPlugin: AnalyzerPlugin = {
  name: "stylus-compiler-plugin",
  version: "1.0.0",
  async detect(adapter) {
    return (await adapter.findFilesByGlob(["**/*.styl", "**/*.stylus"])).length > 0;
  },
  lifecycle: {
    onProjectInit: (adapter) =>
      markCompilerFiles(adapter, ["**/*.styl", "**/*.stylus"], ["stylus"]),
  },
};

export default StylusCompilerPlugin;
