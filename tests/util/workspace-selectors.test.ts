import assert from "node:assert/strict";
import { describe, test } from "vitest";
import {
  matchWorkspacesByDirGlob,
  matchWorkspacesByPkgName,
  parseWorkspaceSelector,
} from "../../src/util/workspace-selectors.js";

describe("workspace selectors", () => {
  test("classifies directory, package and negated selectors", () => {
    assert.deepEqual(parseWorkspaceSelector("./apps/*", "/test/cwd"), {
      type: "dir-glob",
      pattern: "apps/*",
      isNegated: false,
      cwd: "/test/cwd",
    });
    assert.equal(parseWorkspaceSelector("@myorg/pkg", "/test/cwd").type, "pkg-name");
    assert.equal(parseWorkspaceSelector("!packages/legacy", "/test/cwd").isNegated, true);
  });

  test("matches package names exactly, with wildcards and braces", () => {
    const map = new Map([
      ["@test/a", "packages/a"],
      ["@test/b", "packages/b"],
      ["@test/c", "packages/c"],
      ["@web/app", "apps/web"],
    ]);
    const names = [...map.keys()];
    assert.deepEqual(matchWorkspacesByPkgName("@test/a", names, map), ["packages/a"]);
    assert.deepEqual(matchWorkspacesByPkgName("@test/*", names, map).sort(), [
      "packages/a",
      "packages/b",
      "packages/c",
    ]);
    assert.deepEqual(matchWorkspacesByPkgName("@test/{a,c}", names, map).sort(), [
      "packages/a",
      "packages/c",
    ]);
  });

  test("matches workspace directory globs", () => {
    const names = ["packages/a", "packages/b", "apps/web", "apps/api"];
    assert.deepEqual(matchWorkspacesByDirGlob("packages/*", names).sort(), [
      "packages/a",
      "packages/b",
    ]);
    assert.deepEqual(matchWorkspacesByDirGlob("{packages,apps}/a*", names).sort(), [
      "apps/api",
      "packages/a",
    ]);
  });
});
