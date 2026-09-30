import { resolve } from "node:path";
import { readdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const dirPath = resolve(import.meta.dirname, "./module-cache-7f3");
const entries = await readdir(dirPath, { withFileTypes: true });

for (const entry of entries) {
  if (entry.isFile() && entry.name.endsWith(".mjs")) {
    const fullPath = resolve(dirPath, entry.name);
    const moduleUrl = pathToFileURL(fullPath).href;
    const mod = await import(moduleUrl);
    void mod;
  }
}
