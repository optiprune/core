import assert from "node:assert/strict";
import { describe, test } from "vitest";
import { hasStrictlyNsReferences } from "../../src/util/has-strictly-ns-references.js";

const base = () => ({ refs: new Set<string>(), importNs: new Map<string, Set<string>>() });

describe("strict namespace references", () => {
  test("returns false without namespaces", () =>
    assert.deepEqual(hasStrictlyNsReferences(new Map(), "test.ts", base(), "id"), [false]));
  test("detects a single strict namespace", () =>
    assert.deepEqual(
      hasStrictlyNsReferences(
        new Map(),
        "test.ts",
        { ...base(), importNs: new Map([["ns", new Set()]]), refs: new Set(["ns"]) },
        "id",
      ),
      [true, "ns"],
    ));
  test("reports namespace without direct reference", () =>
    assert.deepEqual(
      hasStrictlyNsReferences(
        new Map(),
        "test.ts",
        { ...base(), importNs: new Map([["ns", new Set()]]), refs: new Set() },
        "id",
      ),
      [false, "ns"],
    ));
  test("returns false when refs exist without namespace imports", () =>
    assert.deepEqual(
      hasStrictlyNsReferences(new Map(), "test.ts", { ...base(), refs: new Set(["ns"]) }, "id"),
      [false],
    ));
  test("selects an unused namespace among multiple imports", () =>
    assert.deepEqual(
      hasStrictlyNsReferences(
        new Map(),
        "test.ts",
        {
          ...base(),
          importNs: new Map([
            ["ns", new Set()],
            ["ns2", new Set()],
          ]),
          refs: new Set(["ns"]),
        },
        "id",
      ),
      [false, "ns2"],
    ));
  test("does not classify member access as strict", () =>
    assert.deepEqual(
      hasStrictlyNsReferences(
        new Map(),
        "test.ts",
        { ...base(), importNs: new Map([["ns", new Set()]]), refs: new Set(["ns", "ns.prop"]) },
        "id",
      ),
      [false, "ns"],
    ));
});
