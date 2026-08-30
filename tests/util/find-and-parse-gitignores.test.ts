import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "vitest";
import { findAndParseGitignores } from "../../src/util/glob-core.js";

describe("findAndParseGitignores", () => {
  test("collects hierarchical ignore and unignore patterns", async () => {
    const root = await mkdtemp(join(tmpdir(), "optiprune-gitignore-"));
    const nested = join(root, "packages", "app");
    await mkdir(nested, { recursive: true });
    await writeFile(join(root, ".gitignore"), "node_modules/\n*.log\n");
    await writeFile(join(root, "packages", ".gitignore"), "!keep.log\ndist/\n");
    const result = await findAndParseGitignores(nested);
    assert.equal(result.gitignoreFiles.length, 2);
    assert.ok([...result.ignores].some((pattern) => pattern.includes("node_modules")));
    assert.ok([...result.ignores].some((pattern) => pattern.includes("dist")));
    assert.ok([...result.unignores].some((pattern) => pattern.includes("keep.log")));
  });
});
