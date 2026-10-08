import fs from "node:fs";
import path from "pathe";
import crypto from "node:crypto";
import type { ModuleRecord } from "./types.js";

export const CACHE_VERSION = "3.0";

export interface CacheEntry {
  /** Content fingerprint used to validate the serialized AST. */
  hash: string;
  moduleRecord: ModuleRecord;
  timestamp: number;
}

/** Persistent cache of parsed module records only. Analysis results are never cached. */
export interface AnalysisCache {
  version: string;
  entries: Record<string, CacheEntry>;
}

const CACHE_DIR = ".optiprune";
const CACHE_FILE = "cache.json";

export function getFileHash(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function sanitizeEntries(entries: unknown): Record<string, CacheEntry> {
  if (!entries || typeof entries !== "object" || Array.isArray(entries)) return {};
  const sanitized: Record<string, CacheEntry> = {};
  for (const [file, value] of Object.entries(entries)) {
    if (!value || typeof value !== "object") continue;
    const entry = value as Partial<CacheEntry>;
    if (typeof entry.hash !== "string" || !entry.moduleRecord) continue;
    sanitized[file] = {
      hash: entry.hash,
      moduleRecord: entry.moduleRecord,
      timestamp: typeof entry.timestamp === "number" ? entry.timestamp : Date.now(),
    };
  }
  return sanitized;
}

/** Parse and sanitize local, imported, and externally supplied cache content. */
export function parseCacheContent(raw: string): AnalysisCache {
  try {
    const parsed = JSON.parse(raw) as Partial<AnalysisCache>;
    if (
      parsed &&
      typeof parsed === "object" &&
      parsed.entries &&
      typeof parsed.entries === "object" &&
      !Array.isArray(parsed.entries)
    ) {
      return {
        version: typeof parsed.version === "string" ? parsed.version : CACHE_VERSION,
        entries: sanitizeEntries(parsed.entries),
      };
    }
  } catch {
    // Ignore malformed cache content and rebuild the AST cache.
  }
  return { version: CACHE_VERSION, entries: {} };
}

export function loadCache(rootDir: string): AnalysisCache {
  const cachePath = path.join(rootDir, CACHE_DIR, CACHE_FILE);
  if (!fs.existsSync(cachePath)) return { version: CACHE_VERSION, entries: {} };
  try {
    return parseCacheContent(fs.readFileSync(cachePath, "utf-8"));
  } catch {
    return { version: CACHE_VERSION, entries: {} };
  }
}

export function saveCache(rootDir: string, cache: AnalysisCache): void {
  try {
    const dirPath = path.join(rootDir, CACHE_DIR);
    fs.mkdirSync(dirPath, { recursive: true });
    fs.writeFileSync(path.join(dirPath, CACHE_FILE), JSON.stringify(cache));
  } catch {
    // Cache writes are best-effort and must never fail an analysis.
  }
}

export async function exportCache(rootDir: string, targetPath: string): Promise<void> {
  const cache = loadCache(rootDir);
  await fs.promises.writeFile(targetPath, JSON.stringify(cache));
}

export async function importCache(rootDir: string, sourcePath: string): Promise<void> {
  const content = await fs.promises.readFile(sourcePath, "utf-8");
  saveCache(rootDir, parseCacheContent(content));
}

export function isCacheValid(entry: CacheEntry, currentContent: string): boolean {
  return Boolean(entry?.hash && entry.moduleRecord) && entry.hash === getFileHash(currentContent);
}
