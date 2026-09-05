import path from "node:path";
import { describe, it } from "vitest";
import { assertKnipFixture, fixturesRoot } from "./fixture-helper.js";

const fixtureNames = [
  "sveltekit",
  "sveltekit-config-precedence",
  "sveltekit-vite-config",
  "sveltekit2",
] as const;

describe("sveltekit plugin", () => {
  it.each(fixtureNames)("matches the Knip fixture %s", async (fixtureName) => {
    const rootDir = path.join(fixturesRoot, fixtureName);
    await assertKnipFixture(rootDir);
  });
});
