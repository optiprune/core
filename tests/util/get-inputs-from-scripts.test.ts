import assert from "node:assert/strict";
import { describe, test } from "vitest";
import { getInputsFromScripts } from "../../src/util/get-inputs-from-scripts.js";

describe("script inputs", () => {
  test("extracts binaries from common package-manager commands", () => {
    assert.deepEqual(getInputsFromScripts(["npx eslint .", "npm run build", "bunx prettier src"]), [
      { binary: "npx", args: ["eslint", "."], kind: "binary" },
      { binary: "npm", args: ["run", "build"], kind: "binary" },
      { binary: "bunx", args: ["prettier", "src"], kind: "binary" },
    ]);
  });

  test("marks local script paths as entry inputs", () => {
    assert.deepEqual(getInputsFromScripts(["node ./src/index.ts", "tsx main.ts"]), [
      { binary: "node", args: ["./src/index.ts"], kind: "entry" },
      { binary: "tsx", args: ["main.ts"], kind: "entry" },
    ]);
  });

  test("handles chained commands", () => {
    assert.equal(getInputsFromScripts(["eslint . && tsc --noEmit"]).length, 2);
  });
});
