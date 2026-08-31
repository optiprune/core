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
    // Plugin tests exercise configuration and dependency discovery. Keep the
    // expensive solver and concolic layers opt-in for tests that need them.
    layers: rest.layers ?? { skip3: true, skip4: true },
  };
}
