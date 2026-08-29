import { describe, it, expect } from "vitest";
import { analyze } from "../../src/index.js";
import path from "node:path";

describe("NestJS + Prisma Validation", () => {
  it("should protect decorated classes and revoke if unreachable", async () => {
    const rootDir = path.resolve(__dirname, "../test-repos/nestjs-prisma");
    const report = await analyze({
      rootDir,
      entry: ["src/main.ts"],
      includeConventionalEntries: false,
    });

    // 1. User entity is reachable (via AppModule) and has @Entity -> Should be protected
    const userModule = report.modules.find((m) => m.path.includes("user.entity.ts"));
    const userExport = userModule?.exports.find(
      (e) => e.exportedAs === "User" || e.name === "User",
    );

    expect(userExport).toBeDefined();
    expect(userExport?.isExternalContract).toBe(true);

    // 2. UnusedService has @Injectable BUT is unreachable -> Layer 6 should have revoked it
    const unusedServiceModule = report.modules.find((m) => m.path.includes("unused.service.ts"));
    const unusedServiceExport = unusedServiceModule?.exports.find(
      (e) => e.name === "UnusedService" || e.exportedAs === "UnusedService",
    );
    expect(unusedServiceExport?.isExternalContract).toBe(false);

    // 3. Check for the revocation finding from Layer 6
    const revocationFinding = report.findings.find(
      (f) => f.rule === "protected-contract" && f.file.includes("unused.service.ts"),
    );
    expect(revocationFinding).toBeDefined();
    expect(revocationFinding?.message).toContain("Revoked protection");
  });
});
