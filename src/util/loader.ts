import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export async function _load(filePath: string): Promise<any> {
  if (/\.json5?$/i.test(filePath)) {
    const raw = await readFile(filePath, "utf8");
    if (filePath.endsWith(".json5")) {
      const withoutComments = raw.replace(/\/\/.*$/gm, "");
      const withoutTrailingCommas = withoutComments.replace(/,\s*([}\]])/g, "$1");
      return JSON.parse(withoutTrailingCommas);
    }
    return JSON.parse(raw);
  }
  const module = await import(`${pathToFileURL(filePath).href}?optiprune=${Date.now()}`);
  return module.default ?? module;
}
