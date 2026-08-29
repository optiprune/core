import assert from "node:assert/strict";
import { test } from "vitest";
import { main } from "../../src/index.js";
import baseCounters from "../helpers/baseCounters.js";
import { createOptions } from "../helpers/create-options.js";
import { resolve } from "../helpers/resolve.js";

const cwd = resolve("fixtures/plugins/github-actions");

test("Find dependencies with the GitHub Actions plugin", async () => {
  const options = await createOptions({ cwd });
  const { issues, counters } = await main(options);

  assert(issues.unresolved[".github/workflows/test.yml"]["esbuild-register"]);

  // Let's start out conservatively
  // assert(issues.unresolved['.github/workflows/test.yml']['./script.js']);
  assert(issues.unresolved[".github/actions/composite/action.yml"]["esbuild-register"]);

  assert(issues.binaries[".github/actions/composite/action.yml"]["eslint"]);

  assert(issues.binaries[".github/workflows/test.yml"]["changeset"]);
  assert(issues.binaries[".github/workflows/test.yml"]["eslint"]);
  assert(issues.binaries[".github/workflows/test.yml"]["knip"]);
  assert(!issues.binaries[".github/workflows/test.yml"]["MIT"]);
  assert(!issues.binaries[".github/workflows/test.yml"]["Apache-2.0"]);
  assert(issues.binaries[".github/workflows/test.yml"]["nyc"]);
  assert(issues.binaries[".github/workflows/test.yml"]["playwright"]);
  assert(issues.binaries[".github/workflows/test.yml"]["release-it"]);
  assert(issues.binaries[".github/workflows/test.yml"]["wait-on"]);

  // A composite action's own script, referenced via `$GITHUB_ACTION_PATH`, is
  // resolved relative to the action directory (not reported as unused).
  assert(!(".github/actions/composite/helper.mjs" in issues.files));

  assert.deepEqual(counters, {
    ...baseCounters,
    binaries: 8,
    unresolved: 2,
    processed: 11,
    total: 11,
  });
});
