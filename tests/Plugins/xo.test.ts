import { describe, expect, it } from "vitest";
import { XoPlugin } from "../../src/plugins/xo-plugin.js";
import { runPluginFixture } from "./fixture-utils.js";

describe("xo plugin", () => {
  it("discovers inline XO rules, plugins, and TypeScript overrides", async () => {
    const { context, detected } = await runPluginFixture("xo", XoPlugin);
    expect(detected).toBe(true);
    expect([...context.usedPackages]).toEqual(
      expect.arrayContaining(["xo", "eslint-config-xo-typescript", "eslint-plugin-unicorn"]),
    );
  });
});
