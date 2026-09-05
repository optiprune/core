import type { AnalyzerPlugin } from "../types.js";
import { markCompilerFiles } from "./compiler-utils.js";

export const LessCompilerPlugin: AnalyzerPlugin = {
  name: "less-compiler-plugin",
  version: "1.0.0",
  async detect(adapter) {
    return (await adapter.findFilesByGlob(["**/*.less"])).length > 0;
  },
  lifecycle: {
    onProjectInit: (adapter) => markCompilerFiles(adapter, ["**/*.less"], ["less"]),
  },
};

export default LessCompilerPlugin;
