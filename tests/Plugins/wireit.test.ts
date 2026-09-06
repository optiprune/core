import { describe, expect, it } from "vitest";
import { WireitPlugin } from "../../src/plugins/wireit-plugin.js";
import { runPluginFixture } from "./fixture-utils.js";

describe("wireit plugin", () => {
  it("discovers task inputs, outputs, and chained scripts", async () => {
    const { context, detected } = await runPluginFixture("wireit", WireitPlugin);
    expect(detected).toBe(true);
    expect(context.usedPackages).toContain("wireit");
    expect([...context.runtimeUsedFiles].some((file) => file.endsWith("src/**/*.ts"))).toBe(true);
    expect([...context.runtimeUsedFiles].some((file) => file.endsWith("dist/**/*.d.ts"))).toBe(
      true,
    );
    expect([...context.runtimeUsedFiles].some((file) => file.endsWith("package.json"))).toBe(true);
  });
});
