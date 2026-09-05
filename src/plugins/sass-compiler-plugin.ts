import type { AnalyzerPlugin } from "../types.js";
import { markCompilerFiles } from "./compiler-utils.js";

export const SassCompilerPlugin: AnalyzerPlugin = {
  name: "sass-compiler-plugin",
  version: "1.0.0",
  async detect(adapter) {
    return (await adapter.findFilesByGlob(["**/*.scss", "**/*.sass"])).length > 0;
  },
  lifecycle: {
    onProjectInit: (adapter) => markCompilerFiles(adapter, ["**/*.scss", "**/*.sass"], ["sass"]),
  },
};

export default SassCompilerPlugin;
