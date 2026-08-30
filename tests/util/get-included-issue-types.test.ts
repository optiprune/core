import assert from "node:assert/strict";
import { describe, test } from "vitest";
import {
  getIncludedIssueTypes,
  shorthandDeps,
  shorthandExports,
  shorthandFiles,
} from "../../src/util/get-included-issue-types.js";

const base = { include: [], exclude: [] };

describe("included issue types", () => {
  test("uses defaults and supports overrides", () => {
    const defaults = getIncludedIssueTypes(base);
    assert.equal(defaults.dependencies, true);
    assert.equal(defaults.nsExports, false);
    assert.deepEqual(
      getIncludedIssueTypes({ ...base, includeOverrides: ["duplicates"] }).duplicates,
      true,
    );
    assert.deepEqual(
      getIncludedIssueTypes({ ...base, excludeOverrides: ["duplicates"] }).duplicates,
      false,
    );
  });
  test("supports dependency, export and file shorthands", () => {
    const dependencies = getIncludedIssueTypes({ ...base, includeOverrides: shorthandDeps });
    assert.equal(dependencies.dependencies, true);
    assert.equal(dependencies.devDependencies, true);
    assert.equal(
      getIncludedIssueTypes({ ...base, includeOverrides: shorthandExports }).exports,
      true,
    );
    assert.equal(getIncludedIssueTypes({ ...base, includeOverrides: shorthandFiles }).files, true);
  });
  test("handles production dependencies and invalid types", () => {
    const production = getIncludedIssueTypes({
      ...base,
      includeOverrides: ["dependencies"],
      isProduction: true,
    });
    assert.equal(production.dependencies, true);
    assert.equal(production.devDependencies, false);
    assert.throws(() => getIncludedIssueTypes({ ...base, includeOverrides: ["not-a-rule"] }));
  });
});
