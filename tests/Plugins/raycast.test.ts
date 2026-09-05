import path from "node:path";
import { describe, it } from "vitest";
import { assertKnipFixture, fixturesRoot } from "./fixture-helper.js";

const fixtureNames = ["raycast"] as const;

describe("raycast plugin", () => {
  it.each(fixtureNames)("matches the Knip fixture %s", async (fixtureName) => {
    const rootDir = path.join(fixturesRoot, fixtureName);
    await assertKnipFixture(rootDir);
  });
});
