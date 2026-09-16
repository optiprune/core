import { DiagnosticSeverity } from "vscode-languageserver/node";
import type { Diagnostic } from "vscode-languageserver/node";
import type { Finding, Range as OptiRange } from "./types.js";

export function findingRange(finding: Finding): Diagnostic["range"] {
  const location: OptiRange | undefined = finding.location;
  if (!location) {
    return { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } };
  }
  return {
    start: {
      line: Math.max(0, location.start.line - 1),
      character: Math.max(0, location.start.column - 1),
    },
    end: {
      line: Math.max(0, location.end.line - 1),
      character: Math.max(0, location.end.column - 1),
    },
  };
}

export function findingSeverity(value: Finding["severity"]): DiagnosticSeverity {
  if (value === "error") return DiagnosticSeverity.Error;
  if (value === "warning") return DiagnosticSeverity.Warning;
  return DiagnosticSeverity.Information;
}

export function findingDiagnostic(finding: Finding): Diagnostic {
  return {
    range: findingRange(finding),
    severity: findingSeverity(finding.severity),
    source: "optiprune",
    code: finding.rule,
    message: `${finding.message} (confidence: ${finding.confidence})`,
  };
}
