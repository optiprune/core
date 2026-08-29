import assert from "node:assert/strict";
import { test } from "vitest";
import { main } from "../../src/index.js";
import { join } from "../../src/util/path.js";
import baseCounters from "../helpers/baseCounters.js";
import { createOptions } from "../helpers/create-options.js";
import { resolve } from "../helpers/resolve.js";

const cwd = resolve("fixtures/workspaces/tsconfig-package-extends");

test("Include transitive workspace dependencies of the selected workspace", async () => {
  const options = await createOptions({
    cwd,
    workspace: "@fixtures/workspaces-tsconfig-package-extends__client",
  });
  const { issues, counters, includedWorkspaceDirs } = await main(options);

  assert(!issues.devDependencies["apps/client/package.json"]?.["@types/chrome"]);
  assert(includedWorkspaceDirs.includes(join(cwd, "packages/tsconfig")));
  assert(includedWorkspaceDirs.includes(join(cwd, "packages/tsconfig-base")));
  assert(!includedWorkspaceDirs.includes(join(cwd, "packages/ignored")));

  assert.deepEqual(counters, {
    ...baseCounters,
    processed: 1,
    total: 1,
  });
});
