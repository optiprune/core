import assert from "node:assert/strict";
import { describe, test } from "vitest";
import { Table } from "../../src/util/table.js";

describe("table utility", () => {
  test("renders gaps and truncated values", () => {
    const table = new Table({ maxWidth: 72, truncate: { "col-2": "start" } });
    table
      .row()
      .cell("col-1", "../../runtime/client/idle.prebuilt.js")
      .cell("col-2", "packages/astro/src/core/client-directive/default.ts:1:25");
    table
      .row()
      .cell("col-1", "../../runtime/client/visible.prebuilt.js")
      .cell("col-2", "packages/astro/src/core/client-directive/default.ts:5:28");
    const expected =
      "../../runtime/client/idle.pre…  …c/core/client-directive/default.ts:1:25\n../../runtime/client/visible.…  …c/core/client-directive/default.ts:5:28";
    const output = table.toString();
    assert.equal(output, expected);
    assert.equal(output.indexOf("\n"), 72);
  });

  test("renders a single start-truncated column", () => {
    const table = new Table({ maxWidth: 40, truncate: { filePath: "start" } });
    table.row().cell("filePath", "packages/astro/src/core/client-directive/default.ts");
    table.row().cell("filePath", "packages/astro/src/integrations/hooks.ts");
    assert.equal(
      table.toString(),
      "…ro/src/core/client-directive/default.ts\npackages/astro/src/integrations/hooks.ts",
    );
  });

  test("keeps none-truncated values and distributes widths", () => {
    const table = new Table({ maxWidth: 72, truncate: { "col-3": "none", "col-4": "start" } });
    table
      .row()
      .cell("col-1", "renderFontFace")
      .cell("col-2", undefined)
      .cell("col-3", "function")
      .cell("col-4", "packages/astro/src/assets/fonts/implementations/css-renderer.ts:15:17");
    table
      .row()
      .cell("col-1", "telemetryNotice")
      .cell("col-2", "msg")
      .cell("col-3", undefined)
      .cell("col-4", "packages/astro/src/core/messages.ts:123:17");
    table
      .row()
      .cell("col-1", "normalizeInjectedTypeFilename")
      .cell("col-2", undefined)
      .cell("col-3", "function")
      .cell("col-4", "packages/astro/src/integrations/hooks.ts:157:17");
    const lines = table.toString().split("\n");
    assert.deepEqual(lines, [
      "renderFontFace           function  …mplementations/css-renderer.ts:15:17",
      "telemetryNotice     msg            …es/astro/src/core/messages.ts:123:17",
      "normalizeInjected…       function  …tro/src/integrations/hooks.ts:157:17",
    ]);
    assert.ok(lines.every((line) => line.length === 72));
  });

  test("renders a header", () => {
    const table = new Table({ header: true });
    table.row().cell("A", "A1").cell("B", "B1").cell("C", 1);
    table.row().cell("A", "A2").cell("B", "B2").cell("C", 2);
    assert.equal(table.toString(), "A   B   C\n--  --  -\nA1  B1  1\nA2  B2  2");
  });

  test("is idempotent", () => {
    const table = new Table({ header: true });
    table.row().cell("A", "A1").cell("B", 1);
    table.row().cell("A", "A2").cell("B", 2);
    assert.equal(table.toString(), table.toString());
  });

  test("renders zero as 0", () => {
    const table = new Table({ header: true });
    table.row().cell("name", "fast").cell("count", 0);
    table.row().cell("name", "slow").cell("count", 42);
    assert.equal(table.toString(), "name  count\n----  -----\nfast      0\nslow     42");
  });

  test("sorts in ascending and descending order", () => {
    const table = new Table();
    table.row().cell("n", 1);
    table.row().cell("n", 3);
    table.row().cell("n", 2);
    assert.equal(table.sort("n").toString(), "1\n2\n3");
    assert.equal(table.sort("n", "desc").toString(), "3\n2\n1");
    assert.equal(table.sort("n", "asc").toString(), "1\n2\n3");
  });

  test("does not truncate a column configured as none", () => {
    const table = new Table({ maxWidth: 20, truncate: { kept: "none", other: "end" } });
    table.row().cell("kept", "this-long-value-must-stay").cell("other", "also-quite-long");
    assert.ok(table.toString().includes("this-long-value-must-stay"));
  });
});
