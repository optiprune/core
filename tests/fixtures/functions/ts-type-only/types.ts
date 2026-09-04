/**
 * Fixture: TypeScript type-only exports that should NEVER be reported as unused-export.
 *
 * All of the following constructs are erased by the TypeScript compiler at runtime.
 * OptiPrune must not emit `unused-export` findings for any of them, even when no
 * other file in the project imports them.
 */

// 1. Plain interface
export interface CacheEntry {
  key: string;
  value: unknown;
  ttl: number;
}

// 2. Type alias
export type Confidence = "high" | "medium" | "low" | "info";

// 3. Enum (const – inlined by the compiler, no runtime object)
export const enum Status {
  Active = "active",
  Inactive = "inactive",
}

// 4. Explicit `export type` alias
export type DynamicPattern = {
  prefix: string;
  suffix: string;
  baseDirectory: string;
  candidates: string[];
};

// 5. Generic interface
export interface Repository<T> {
  findById(id: string): Promise<T | null>;
  save(entity: T): Promise<void>;
}

// 6. Value export that IS used (should NOT appear in findings either)
export const VERSION = "1.0.0";
