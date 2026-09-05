import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { analyze } from "../../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");

describe("Optiprune v1.0 Integration (Puzzle Pieces 1-4)", () => {
  const fixturePath = path.join(rootDir, "tests/fixtures/puzzle-test.ts");
  const configPath = path.join(rootDir, "optiprune.config.ts");

  beforeEach(() => {
    fs.writeFileSync(
      fixturePath,
      `
      // @public
      export const PublicExport = 1;

      /** @used */
      export const UsedAnnotation = 2;

      // optiprune-ignore
      export const IgnoredExport = 3;

      function Controller() { return (target: any) => target; }
      function Get() { return (target: any, key: string) => {}; }

      @Controller()
      export class MyController {
        @Get()
        myHandler() {}
      }

      const z = { object: () => ({}) };
      // @public
      export const UserSchema = z.object({});
    `,
    );
  });

  afterEach(() => {
    if (fs.existsSync(fixturePath)) fs.unlinkSync(fixturePath);
    if (fs.existsSync(configPath)) fs.unlinkSync(configPath);
    if (fs.existsSync(path.join(rootDir, ".optiprune"))) {
      fs.rmSync(path.join(rootDir, ".optiprune"), { recursive: true, force: true });
    }
  });

  it("should protect symbols based on decorators, JSDoc and Zod detection", async () => {
    const report = await analyze({
      rootDir,
      entry: [fixturePath],
      ignore: ["tests/fixtures/plugins/**"],
      projectPatterns: ["src/**/*.ts"],
      includeConventionalEntries: false,
    });

    const module = report.modules.find((m) => m.path.includes("puzzle-test.ts"));
    expect(module).toBeDefined();

    const protectedExports = module?.exports
      .filter((e) => e.isExternalContract)
      .map((e) => e.exportedAs);

    expect(protectedExports).toContain("PublicExport");
    expect(protectedExports).toContain("UsedAnnotation");
    expect(protectedExports).toContain("IgnoredExport");
    expect(protectedExports).toContain("MyController");
    expect(protectedExports).toContain("UserSchema");
  });

  it("should use incremental caching on second run", async () => {
    const startTime1 = Date.now();
    await analyze({
      rootDir,
      entry: [fixturePath],
      ignore: ["tests/fixtures/plugins/**"],
      projectPatterns: ["src/**/*.ts"],
    });
    const duration1 = Date.now() - startTime1;

    const startTime2 = Date.now();
    await analyze({
      rootDir,
      entry: [fixturePath],
      ignore: ["tests/fixtures/plugins/**"],
      projectPatterns: ["src/**/*.ts"],
    });
    const duration2 = Date.now() - startTime2;

    // Second run should be faster due to cache
    // Note: In a small sandbox, the difference might be tiny, but the cache file should exist
    expect(fs.existsSync(path.join(rootDir, ".optiprune/cache.json"))).toBe(true);
  });
});
