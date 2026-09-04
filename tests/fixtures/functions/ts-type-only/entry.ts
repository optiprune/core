/**
 * Entry point for the ts-type-only-test fixture.
 *
 * Intentionally imports only the runtime value (VERSION) from types.ts.
 * All type-only exports (CacheEntry, Confidence, Status, DynamicPattern,
 * Repository) are deliberately NOT imported here – they should still not
 * be flagged as unused-export by OptiPrune.
 */
import { VERSION } from "./types.js";

export function getVersion(): string {
  return VERSION;
}
