import type { AnalyzerOptions } from "../../src/types.js";

type TestOptions = AnalyzerOptions & {
  cwd?: string;
  isSession?: boolean;
  isShowProgress?: boolean;
};

export function createOptions(options: TestOptions): AnalyzerOptions {
  const { cwd, isSession: _isSession, isShowProgress: _isShowProgress, ...rest } = options;
  return {
    ...rest,
    rootDir: cwd ?? rest.rootDir,
  };
}
