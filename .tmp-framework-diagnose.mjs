import path from "node:path";
import { analyze } from "./dist/index.js";

const rootDir = path.resolve("tests/fixtures/framework-lab-monorepo");
const report = await analyze({ rootDir, layers: { skip3: true, skip4: true }, reportUnusedExportsInUnreachableFiles: true });
console.log(JSON.stringify({
  summary: report.summary,
  entryPoints: report.entryPoints,
  errors: report.errors,
  files: report.findings.filter((finding) => finding.rule === "unreachable-file").map((finding) => finding.file),
  findings: report.findings.map((finding) => ({ rule: finding.rule, file: finding.file, evidence: finding.evidence })),
}, null, 2));
