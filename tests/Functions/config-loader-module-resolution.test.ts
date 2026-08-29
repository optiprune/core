import fs from "node:fs/promises";
import os from "node:os";
import path from "pathe";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../../src/config-loader.js";

const roots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function rootWith(files: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "optiprune-config-loader-"));
  roots.push(root);
  for (const [file, content] of Object.entries(files)) {
    const target = path.join(root, file);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, "utf8");
  }
  return root;
}

describe("TypeScript config module resolution", () => {
  it("loads a config that imports a local TypeScript helper instead of throwing module-not-found", async () => {
    const root = await rootWith({
      "optiprune.config.ts": [
        'import { sharedOptions } from "./config/shared-options.js";',
        "export default sharedOptions;",
      ].join("\n"),
      "config/shared-options.ts": [
        "export const sharedOptions = {",
        '  entry: ["src/index.ts"],',
        "  includeConventionalEntries: false,",
        "  verbose: true,",
        "};",
      ].join("\n"),
    });

    await expect(loadConfig(root)).resolves.toMatchObject({
      entry: ["src/index.ts"],
      includeConventionalEntries: false,
      verbose: true,
    });
    const temporaryBundles = (await fs.readdir(root)).filter(
      (name) => name.startsWith(".optiprune.config.") && name.endsWith(".mjs"),
    );
    expect(temporaryBundles).toEqual([]);
  });

  it("reports a concise cause and cleans up temporary bundles when a config import cannot resolve", async () => {
    const root = await rootWith({
      "optiprune.config.ts": 'import "./missing-helper.ts";\nexport default {};\n',
    });
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(loadConfig(root)).resolves.toEqual({});

    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining("Failed to load optiprune.config.ts:"),
    );
    const temporaryBundles = (await fs.readdir(root)).filter(
      (name) => name.startsWith(".optiprune.config.") && name.endsWith(".mjs"),
    );
    expect(temporaryBundles).toEqual([]);
  });
});
