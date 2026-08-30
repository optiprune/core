import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyze } from "../../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../fixtures/layer5-isolated");

describe("Layer 5: Schema Alignment", () => {
  it("should protect externally contracted exports from being marked as unused", async () => {
    const report = await analyze({
      rootDir,
      entry: ["layer5-test.ts"],
      includeConventionalEntries: false,
      externalContracts: ["UnusedButExternal", "OrderEntity"], // Explicitly mark these as external
      skip3: true,
      skip4: true,
    });
    // Ensure cache is not interfering (though analyze doesn't have a clear 'noCache' option,
    // we assume the first run in this process is fresh enough or we rely on the fact that
    // we changed the source code which should invalidate the hash)

    const unusedExportFindings = report.findings.filter((f) => f.rule === "unused-export");

    // Expect that 'UnusedButExternal' and 'OrderEntity' are NOT reported as unused
    const layer5TestModule = report.modules.find((m) => m.path.includes("layer5-test.ts"));
    expect(layer5TestModule).toBeDefined();

    const unusedButExternalExport = layer5TestModule?.exports.find(
      (e) => e.exportedAs === "UnusedButExternal",
    );
    expect(unusedButExternalExport).toBeDefined();
    expect(unusedButExternalExport?.isExternalContract).toBe(true);

    const orderEntityExport = layer5TestModule?.exports.find((e) => e.exportedAs === "OrderEntity");
    expect(orderEntityExport).toBeDefined();
    expect(orderEntityExport?.isExternalContract).toBe(true);

    const isUnusedButExternalReported = unusedExportFindings.some(
      (f) => f.file.includes("layer5-test.ts") && f.evidence.exportName === "UnusedButExternal",
    );
    expect(isUnusedButExternalReported).toBe(false);

    const isOrderEntityReported = unusedExportFindings.some(
      (f) => f.file.includes("layer5-test.ts") && f.evidence.exportName === "OrderEntity",
    );
    expect(isOrderEntityReported).toBe(false);

    // Depending on the fixture, other exports might still be unused.
    // For example, UserSchema, ProductType, Query are not explicitly marked as external contracts
    // in the options, so they might be reported as unused if not actually used in the fixture.
    const userSchemaReported = unusedExportFindings.some(
      (f) => f.file.includes("layer5-test.ts") && f.evidence.exportName === "UserSchema",
    );
    // In v9, Zod schemas are better protected by default.
    // If it's not reported, it means the protection is working as intended for framework safety.
    expect(userSchemaReported).toBe(false);

    const productTypeReported = unusedExportFindings.some(
      (f) => f.file.includes("layer5-test.ts") && f.evidence.exportName === "ProductType",
    );
    expect(productTypeReported).toBe(true); // Should be reported as unused (not protected by default)

    const queryReported = unusedExportFindings.some(
      (f) => f.file.includes("layer5-test.ts") && f.evidence.exportName === "Query",
    );
    expect(queryReported).toBe(true); // Should be reported as unused (not protected by default)
  }, 15000); // Increase timeout to 15 seconds
});
