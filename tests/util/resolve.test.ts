import assert from "node:assert/strict";
import { describe, test } from "vitest";
import { _resolveDeclarationSync, _resolveModuleSync } from "../../src/util/resolve.js";
import { resolve } from "../helpers/resolve.js";

const fixture = "tests/fixtures/resolution/declaration-extension-alias";
const containingFile = resolve(`${fixture}/index.d.ts`);

describe("resolve utility", () => {
  test("resolves TypeScript extensions to emitted declarations", () => {
    for (const [specifier, declaration] of [
      ["./target.ts", "target.d.ts"],
      ["./target.mts", "target.d.mts"],
      ["./target.cts", "target.d.cts"],
    ]) {
      assert.equal(
        _resolveDeclarationSync(specifier, containingFile)?.path,
        resolve(`${fixture}/${declaration}`),
      );
    }
  });

  test("resolves an existing local module", () => {
    assert.equal(
      _resolveModuleSync("./target.d.ts", containingFile),
      resolve(`${fixture}/target.d.ts`),
    );
    assert.equal(_resolveModuleSync("./missing", containingFile), undefined);
  });
});
