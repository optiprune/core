import assert from "node:assert/strict";
import { describe, test } from "vitest";
import { parseCodeowners } from "../../src/util/codeowners.js";

describe("codeowners", () => {
  test("resolves fallback, extensions, directories and specific files", () => {
    const findOwners = parseCodeowners(`# Global owner as fallback
*       @global-owner
*.js    @js-owner
*.ts    @ts-owner
/docs/          @docs-team
/src/lib/       @lib-team
/apps/web/      @web-team
**/tests/       @test-team
/src/lib/core.js    @core-team`);
    assert.deepEqual(findOwners("README.md"), ["@global-owner"]);
    assert.deepEqual(findOwners("utils.js"), ["@js-owner"]);
    assert.deepEqual(findOwners("src/types.ts"), ["@ts-owner"]);
    assert.deepEqual(findOwners("docs/api.md"), ["@docs-team"]);
    assert.deepEqual(findOwners("src/lib/utils.js"), ["@lib-team"]);
    assert.deepEqual(findOwners("src/lib/core.js"), ["@core-team"]);
    assert.deepEqual(findOwners("apps/web/index.js"), ["@web-team"]);
    assert.deepEqual(findOwners("src/tests/unit.js"), ["@test-team"]);
  });

  test("distinguishes shallow and deep patterns", () => {
    const findOwners = parseCodeowners("/docs/* @docs-shallow\n/api/ @api-deep");
    assert.deepEqual(findOwners("docs/readme.md"), ["@docs-shallow"]);
    assert.deepEqual(findOwners("docs/guides/start.md"), []);
    assert.deepEqual(findOwners("api/endpoint.js"), ["@api-deep"]);
    assert.deepEqual(findOwners("api/v1/users.js"), ["@api-deep"]);
  });

  test("preserves multiple owners", () => {
    const findOwners = parseCodeowners(
      "*.js @js-owner\n/src/ @lead-dev @senior-dev @architect\n/docs/ @tech-writer @docs-team docs@example.com\n/api/ @backend-team api@company.com @devops-team",
    );
    assert.deepEqual(findOwners("utils.js"), ["@js-owner"]);
    assert.deepEqual(findOwners("src/app.ts"), ["@lead-dev", "@senior-dev", "@architect"]);
    assert.deepEqual(findOwners("docs/api.md"), ["@tech-writer", "@docs-team", "docs@example.com"]);
    assert.deepEqual(findOwners("api/users.js"), [
      "@backend-team",
      "api@company.com",
      "@devops-team",
    ]);
  });

  test("uses the last matching rule", () => {
    const findOwners = parseCodeowners("/src/lib/ @first-owner\n/src/lib/ @second-owner");
    assert.deepEqual(findOwners("src/lib/file.js"), ["@second-owner"]);
  });

  test("resolves owned and unowned paths", () => {
    const findOwners = parseCodeowners("/is/not-owned @some/owner\n/is/owned @some/other-owner");
    assert.deepEqual(findOwners("is/not-owned"), ["@some/owner"]);
    assert.deepEqual(findOwners("is/owned"), ["@some/other-owner"]);
  });

  test("resolves ownership for nested files", () => {
    const findOwners = parseCodeowners("/src/ @team");
    const paths = ["src/file1.js", "src/file2.js", "src/nested/file3.js"];
    assert.ok(paths.every((path) => parseCodeowners("/src/ @team")(path)[0] === "@team"));
  });
});
