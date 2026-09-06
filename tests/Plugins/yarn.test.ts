import { describe, expect, it } from "vitest";
import { YarnPlugin } from "../../src/plugins/yarn-plugin.js";
import { runPluginFixture } from "./fixture-utils.js";

describe("yarn plugin", () => {
  it("discovers Yarn Berry PnP settings and package extensions", async () => {
    const { context, detected } = await runPluginFixture("yarn-berry", YarnPlugin);
    expect(detected).toBe(true);
    expect(context.options.repositoryType).toBe("single-package");
    expect([...context.protectedConfigFiles].some((file) => file.endsWith(".yarnrc.yml"))).toBe(
      true,
    );
  });
});
