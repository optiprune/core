import assert from "node:assert/strict";
import { test } from "vitest";
import { main } from "../../src/index.js";
import baseCounters from "../helpers/baseCounters.js";
import { createOptions } from "../helpers/create-options.js";
import { resolve } from "../helpers/resolve.js";

const cwd = resolve("fixtures/plugins/graphql-codegen-output");

test("Mark graphql-codegen generated outputs as entries", async () => {
  const options = await createOptions({ cwd });
  const { issues, counters } = await main(options);

  assert(!issues.exports["src/gql/graphql.ts"]?.["GeneratedDocument"]);
  assert(!issues.types["src/gql/graphql.ts"]?.["GeneratedQuery"]);
  assert(!("src/gql/graphql.ts" in issues.files));

  assert.deepEqual(counters, {
    ...baseCounters,
    processed: 2,
    total: 2,
  });
});
