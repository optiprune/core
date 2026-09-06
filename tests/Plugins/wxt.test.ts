import { describe, expect, it } from "vitest";
import { WxtPlugin } from "../../src/plugins/wxt-plugin.js";
import { runPluginFixture } from "./fixture-utils.js";

describe("wxt plugin", () => {
  it("discovers the WXT config and extension entrypoints", async () => {
    const { context, detected } = await runPluginFixture("wxt", WxtPlugin);
    expect(detected).toBe(true);
    expect(context.usedPackages).toContain("wxt");
    expect(context.options.configFiles.some((file) => file.endsWith("wxt.config.ts"))).toBe(true);
  });
});
