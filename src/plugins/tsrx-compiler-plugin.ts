import type { AnalyzerPlugin } from "../types.js";
import { markCompilerFiles } from "./compiler-utils.js";

export const TsrxCompilerPlugin: AnalyzerPlugin = {
  name: "tsrx-compiler-plugin",
  version: "1.0.0",
  async detect(adapter) {
    return (await adapter.findFilesByGlob(["**/*.tsrx"])).length > 0;
  },
  lifecycle: {
    onProjectInit: (adapter) => markCompilerFiles(adapter, ["**/*.tsrx"], ["tsrx"]),
  },
};

export default TsrxCompilerPlugin;
