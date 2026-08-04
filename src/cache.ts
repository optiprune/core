import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { ModuleRecord } from "./types.js";

export interface CacheEntry {
  hash: string;
  moduleRecord: ModuleRecord;
  timestamp: number;
}

export interface AnalysisCache {
  version: string;
  entries: Record<string, CacheEntry>;
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
  return { version: "1.0", entries: {} };
}

export function saveCache(rootDir: string, cache: AnalysisCache): void {
  try {
    const dirPath = path.join(rootDir, CACHE_DIR);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
    fs.writeFileSync(path.join(dirPath, CACHE_FILE), JSON.stringify(cache, null, 2));
  } catch (e) {
    // Ignore cache write errors in environments like tests where rootDir might be problematic
  }
}

export function isCacheValid(entry: CacheEntry, currentContent: string): boolean {
  return entry.hash === getFileHash(currentContent);
}
