import fs from "node:fs";
import path from "pathe";
import crypto from "node:crypto";
import type { ModuleRecord, Finding, AnalysisReport } from "./types.js";

export interface CacheEntry {
  hash: string;
  moduleRecord: ModuleRecord;
  findings?: Finding[];
  isReachable?: boolean;
  timestamp: number;
  /** Compact per-file analysis summary for tooling and diagnostics. */
  result?: Array<{ line?: number; rule: string; message: string }>;
}

export interface AnalysisCache {
  version: string;
  entries: Record<string, CacheEntry>;
  /** Fingerprint of options that affect analysis output. */
  analysisKey?: string;
  /** SHA-256 fingerprints for every discovered source file. */
  fileHashes?: Record<string, string>;
  /** Cheap filesystem metadata used to avoid rereading unchanged files. */
  fileStats?: Record<string, { size: number; mtimeMs: number }>;
  /** Complete report, stored compactly enough for fast unchanged reruns. */
  report?: AnalysisReport;
}

const CACHE_DIR = ".optiprune";
const CACHE_FILE = "cache.json";

export function getFileHash(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

export function loadCache(rootDir: string): AnalysisCache {
  const cachePath = path.join(rootDir, CACHE_DIR, CACHE_FILE);
  if (fs.existsSync(cachePath)) {
    try {
      return JSON.parse(fs.readFileSync(cachePath, "utf-8"));
    } catch (e) {
      // Ignore
    }
  }
  return { version: "2.1", entries: {} };
}

export function saveCache(rootDir: string, cache: AnalysisCache): void {
  try {
    const dirPath = path.join(rootDir, CACHE_DIR);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
    // Cache files are machine-only data. Compact serialization substantially
    // reduces both synchronous write time and the next run's parse/IO cost.
    fs.writeFileSync(path.join(dirPath, CACHE_FILE), JSON.stringify(cache));
  } catch (e) {
    // Ignore cache write errors in environments like tests where rootDir might be problematic
  }
}

/**
 * Exports the current cache to a standalone JSON file, 
 * suitable for uploading to a remote storage or CI cache.
 */
export async function exportCache(rootDir: string, targetPath: string): Promise<void> {
  const cache = loadCache(rootDir);
  await fs.promises.writeFile(targetPath, JSON.stringify(cache));
}

/**
 * Imports a cache from an external JSON file into the local .optiprune directory.
 */
export async function importCache(rootDir: string, sourcePath: string): Promise<void> {
  const content = await fs.promises.readFile(sourcePath, "utf-8");
  const cache = JSON.parse(content) as AnalysisCache;
  saveCache(rootDir, cache);
}

export function isCacheValid(entry: CacheEntry, currentContent: string): boolean {
  return entry.hash === getFileHash(currentContent);
}
