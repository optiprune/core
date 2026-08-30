import { createSession } from "./session/session.js";
import type { AnalyzerOptions } from "./types.js";
export async function run(options: AnalyzerOptions) {
  const sessionHandler = await createSession(options);
  return { session: sessionHandler };
}
