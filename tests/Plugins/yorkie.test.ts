import { describe, expect, it } from "vitest";
import { SimpleGitHooksPlugin } from "../../src/plugins/simple-git-hooks-plugin.js";
import { runPluginFixture } from "./fixture-utils.js";

describe("yorkie plugin", () => {
  it("discovers Yorkie and protects package.json gitHooks tasks", async () => {
    const { context, detected } = await runPluginFixture("yorkie", SimpleGitHooksPlugin);
    expect(detected).toBe(true);
    expect(context.usedPackages).toContain("yorkie");
    expect([...context.runtimeUsedFiles].some((file) => file.endsWith("package.json"))).toBe(true);
  });
});
