import { describe, expect, it } from "vitest";
import { WranglerPlugin } from "../../src/plugins/wrangler-plugin.js";
import { runPluginFixture } from "./fixture-utils.js";

describe("wrangler plugin", () => {
  it("discovers the Worker entrypoint and static asset directory", async () => {
    const { context, detected } = await runPluginFixture("wrangler", WranglerPlugin);
    expect(detected).toBe(true);
    expect(context.usedPackages).toContain("wrangler");
    expect(
      context.entryPoints.has(
        [...context.entryPoints].find((file) => file.endsWith("src/index.ts")) ?? "",
      ),
    ).toBe(true);
    expect([...context.protectedConfigFiles].some((file) => file.endsWith("wrangler.toml"))).toBe(
      true,
    );
    expect([...context.runtimeUsedFiles].some((file) => file.endsWith("public"))).toBe(true);
  });
});
