import { describe, expect, it } from "vitest";
import path from "pathe";
import { analyze } from "../src/index.js";

const fixtureRoot = path.resolve(__dirname, "./fixtures/framework-lab-monorepo");

function findingKey(finding: any): string {
  const evidence = finding.evidence ?? {};
  const detail = evidence.package
    ? `package:${evidence.package}`
    : evidence.exportName && evidence.memberName
      ? `export:${evidence.exportName}/member:${evidence.memberName}`
      : evidence.exportName
        ? `export:${evidence.exportName}`
        : evidence.memberName
          ? `member:${evidence.memberName}`
          : evidence.terminalType
            ? `terminal:${evidence.terminalType}`
            : evidence.schemaName
              ? `schema:${evidence.schemaName}`
              : "";
  return `${finding.rule}|${finding.file.replace(`${fixtureRoot}/`, "")}|${detail}`;
}

const expectedFindings = new Set([
  "unreachable-file|apps/nest-api/src/graphql.ts|",
  "unreachable-file|packages/core/src/dead-code.ts|",
  "unreachable-file|packages/core/src/unused.ts|",
  "unreachable-file|packages/ui/src/UnusedPanel.tsx|",
  "unused-member|apps/nest-api/src/graphql.ts|export:resolvers/member:Query",
  "unused-export|apps/nest-api/src/graphql.ts|export:typeDefs",
  "unused-export|apps/nest-api/src/graphql.ts|export:resolvers",
  "unused-member|packages/core/build.config.ts|export:default/member:entries",
  "unused-member|packages/core/build.config.ts|export:default/member:declaration",
  "unused-member|packages/core/build.config.ts|export:default/member:clean",
  "unreachable-statement|packages/core/src/dead-code.ts|terminal:ReturnStatement",
  "unused-export|packages/core/src/dead-code.ts|export:unusedExport",
  "unused-export|packages/core/src/dead-code.ts|export:unreachableHelper",
  "unused-export|packages/core/src/dead-code.ts|export:UnusedService",
  "unused-member|packages/core/src/unused.ts|export:orphanConstant/member:status",
  "unused-member|packages/core/src/unused.ts|export:orphanConstant/member:values",
  "unused-export|packages/core/src/unused.ts|export:orphanConstant",
  "unused-export|packages/ui/src/UnusedPanel.tsx|export:UnusedPanel",
  "unused-export|scripts/esbuild-entry.ts|export:esbuildFixture",
  "unused-openapi-schema|openapi/openapi.yaml|schema:UnusedSchema",
  "unused-dependency|apps/nest-api/package.json|package:graphql",
  "unused-dependency|apps/next-app/package.json|package:react-dom",
  "unused-dependency|package.json|package:@apollo/server",
  "unused-dependency|package.json|package:graphql",
  "unused-dependency|package.json|package:react-dom",
  "unused-dependency|package.json|package:openapi-types",
  "unused-dev-dependency|package.json|package:openapi-schema-validator",
  "unused-dev-dependency|package.json|package:eslint",
  "unused-dev-dependency|package.json|package:prettier",
  "unused-dev-dependency|package.json|package:chokidar",
  "unused-dev-dependency|package.json|package:lodash",
  "unused-dev-dependency|package.json|package:dotenv",
  "unused-dev-dependency|package.json|package:rimraf",
  "unused-dev-dependency|package.json|package:unused-dependency",
  "unused-dependency|packages/core/package.json|package:lodash",
  "unused-dependency|packages/ui/package.json|package:@fixture/core",
  "unused-dev-dependency|packages/webpack-fixture/package.json|package:webpack-cli",
]);

describe("framework-lab strict benchmark", () => {
  it("matches the complete ground truth with zero analyzer errors or drift", async () => {
    const report = await analyze({
      rootDir: fixtureRoot,
      layers: { skip3: true, skip4: true },
      reportUnusedExportsInUnreachableFiles: true,
    });

    expect(report.summary).toMatchObject({
      filesDiscovered: 29,
      filesParsed: 29,
      filesRecovered: 0,
      filesFallback: 0,
      entryPoints: 6,
      cycles: 2,
      findings: expectedFindings.size,
      errors: 0,
    });

    expect(report.entryPoints.sort()).toEqual([
      "apps/nest-api/src/main.ts",
      "apps/next-app/app/page.tsx",
      "apps/next-app/app/unused-page.tsx",
      "packages/core/src/index.ts",
      "packages/ui/src/main.tsx",
      "scripts/validate-openapi.mjs",
    ]);

    const actualCycles = report.components
      .filter((component: any) => component.isCycle)
      .map((component: any) => [...component.modules].sort())
      .sort((left: string[], right: string[]) => left.join("\n").localeCompare(right.join("\n")));
    const expectedCycles = [
      ["packages/core/src/cycle-a.ts", "packages/core/src/cycle-b.ts"],
      ["packages/webpack-fixture/src/alpha.js", "packages/webpack-fixture/src/beta.js"],
    ].sort((left, right) => left.join("\n").localeCompare(right.join("\n")));
    expect(actualCycles).toEqual(expectedCycles);

    const actualFindings = new Set(report.findings.map(findingKey));
    expect(actualFindings).toEqual(expectedFindings);
  });
});
