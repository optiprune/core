import type { AnalysisReport, Finding } from "./types.js";
import path from "pathe";
import fs from "node:fs";

export function formatTerminal(report: AnalysisReport, options: { showCycles?: boolean } = {}): string {
  const lines: string[] = [];
  lines.push(`\x1b[1mOptiprune Analysis Report v${report.version}\x1b[0m`);
  lines.push(`Root: ${report.rootDir}`);
  lines.push("");

  const summary = report.summary;
  lines.push(`\x1b[1mSummary:\x1b[0m`);
  lines.push(`  Files: ${summary.filesDiscovered} discovered, ${summary.filesParsed} parsed`);
  lines.push(`  Findings: ${summary.findings} total (\x1b[31m${summary.errors} errors\x1b[0m, \x1b[33m${summary.warnings} warnings\x1b[0m)`);
  if (options.showCycles) {
    const cycles = report.components.filter((component) => component.isCycle);
    lines.push(`  Cycles: ${cycles.length}`);
    for (const cycle of cycles) {
      lines.push(`    Cycle #${cycle.id}: ${cycle.modules.join(" -> ")}`);
    }
  }
  lines.push("");

  if (report.findings.length === 0) {
    lines.push("\x1b[32m✔ No issues found!\x1b[0m");
    return lines.join("\n");
  }

  let currentFile = "";
  for (const finding of report.findings) {
    if (finding.file !== currentFile) {
      currentFile = finding.file;
      lines.push(`\x1b[1m\x1b[4m${currentFile}\x1b[0m`);
    }

    const severityColor = finding.severity === "error" ? "\x1b[31m" : "\x1b[33m";
    const loc = finding.location ? `:${finding.location.start.line}:${finding.location.start.column}` : "";
    lines.push(`  ${severityColor}${finding.severity.toUpperCase()}\x1b[0m [${finding.rule}] ${finding.message}`);
    
    if (finding.location) {
        // Simple snippet display (in a real CLI, we'd read the file and show the line)
        lines.push(`    at ${finding.file}${loc} (Confidence: ${finding.confidence})`);
    }
  }

  return lines.join("\n");
}

export function formatSarif(report: AnalysisReport): string {
  const sarif = {
    $schema: "https://schemastore.azurewebsites.net/schemas/json/sarif-2.1.0-rtm.5.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "Optiprune",
            version: report.version,
            informationUri: "https://github.com/optiprune/core",
            rules: Array.from(new Set(report.findings.map(f => f.rule))).map(ruleId => ({
              id: ruleId,
              shortDescription: { text: `Optiprune rule: ${ruleId}` }
            }))
          }
        },
        results: report.findings.map(finding => ({
          ruleId: finding.rule,
          level: finding.severity === "error" ? "error" : "warning",
          message: { text: finding.message },
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: finding.file },
                region: finding.location ? {
                  startLine: finding.location.start.line,
                  startColumn: finding.location.start.column,
                  endLine: finding.location.end.line,
                  endColumn: finding.location.end.column
                } : undefined
              }
            }
          ],
          properties: {
            confidence: finding.confidence,
            evidence: finding.evidence
          }
        }))
      }
    ]
  };

  return JSON.stringify(sarif, null, 2);
}
