import path from "node:path";
import { describe, it } from "vitest";
import { assertKnipFixture, fixturesRoot } from "./fixture-helper.js";

const fixtureNames = ["vitest10"] as const;

describe("vitest10 plugin", () => {
  it.each(fixtureNames)("matches the Knip fixture %s", async (fixtureName) => {
    const rootDir = path.join(fixturesRoot, fixtureName);
    await assertKnipFixture(rootDir);
  });
});
