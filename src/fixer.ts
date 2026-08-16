import { promises as fs } from "node:fs";
import path from "pathe";
import { AnalysisReport, Finding, FixConfig } from "./types.js";
import { readJsonFile } from "./fs-utils.js";

const CONFIDENCE_LEVELS: Record<string, number> = {
  low: 1,
  medium: 2,
  high: 3,
  info: 0,
};

const DEFAULT_SAFE_RULES = new Set([
  "unreachable-file",
  "unused-dependency",
  "unused-dev-dependency",
]);

const SOURCE_EXTENSIONS = new Set([".vue", ".svelte", ".astro"]);

type TextEdit = { start: number; end: number; replacement: string };

function getMinConfidence(config: FixConfig | boolean): number {
  if (typeof config === "boolean") return 3;
  switch (config.confidence) {
    case "all": return 0;
    case "low":
    case "low+": return 1;
    case "medium+": return 2;
    case "high": return 3;
    default: return 3;
  }
}

function isRequestedRule(allowedRules: Set<string>, rule: string): boolean {
  if (allowedRules.has(rule)) return true;
  if (allowedRules.has("files") && rule === "unreachable-file") return true;
  if (allowedRules.has("dependencies") && rule === "unused-dependency") return true;
  if (allowedRules.has("devDependencies") && rule === "unused-dev-dependency") return true;
  if (allowedRules.has("exports") && (rule === "unused-export" || rule === "unused-member")) return true;
  if (allowedRules.has("conditions") && rule === "constant-condition") return true;
  return false;
}

function lineBounds(source: string, lineNumber: number): { start: number; end: number; text: string } | null {
  const lines = source.split("\n");
  const index = lineNumber - 1;
  if (index < 0 || index >= lines.length) return null;
  let start = 0;
  for (let i = 0; i < index; i++) start += (lines[i] ?? "").length + 1;
  const text = lines[index] ?? "";
  return { start, end: start + text.length, text };
}

function extensionOf(file: string): string {
  const match = file.match(/\.[^.\\/]+$/);
  return match ? match[0].toLowerCase() : "";
}

/**
 * Remove only the export modifier for a named declaration. This intentionally
 * does not rewrite export lists or SFC component contracts.
 */
function exportModifierEdit(source: string, finding: Finding): TextEdit | null {
  if (!finding.location || SOURCE_EXTENSIONS.has(extensionOf(finding.file))) return null;
  const bounds = lineBounds(source, finding.location.start.line);
  if (!bounds) return null;
  const column = Math.max(0, finding.location.start.column - 1);
  const prefix = bounds.text.slice(0, column);
  const matches = [...prefix.matchAll(/\bexport\s+(default\s+)?(?=(?:async\s+)?(?:function|class|const|let|var)\b)/g)];
  const match = matches.at(-1);
  if (!match || match.index === undefined) return null;
  const modifier = match[0];
  return {
    start: bounds.start + match.index,
    end: bounds.start + match.index + modifier.length,
    replacement: "",
  };
}

function forceExportEdit(source: string, finding: Finding): TextEdit | null {
  if (SOURCE_EXTENSIONS.has(extensionOf(finding.file))) return null;
  const exportName = finding.evidence?.exportName;
  if (typeof exportName !== "string" || !exportName) return null;
  const escaped = exportName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const declaration = new RegExp(`\\bexport\\s+(?:default\\s+)?(?=(?:async\\s+)?(?:function|class|const|let|var)\\s+${escaped}\\b)`);
  const declarationMatch = declaration.exec(source);
  if (declarationMatch && declarationMatch.index !== undefined) {
    const exportOffset = declarationMatch.index;
    return { start: exportOffset, end: exportOffset + (declarationMatch[0]?.match(/\s*$/)?.[0].length ?? 0) + "export".length, replacement: "" };
  }

  const listPattern = /\bexport\s*\{([^{}]*)\}/g;
  let listMatch: RegExpExecArray | null;
  while ((listMatch = listPattern.exec(source))) {
    const body = listMatch[1] ?? "";
    const specifier = new RegExp(`(^|,)\\s*${escaped}(?:\\s+as\\s+[A-Za-z_$][\\w$]*)?\\s*(?=,|$)`).exec(body);
    if (!specifier || specifier.index === undefined) continue;
    const bodyStart = (listMatch.index ?? 0) + listMatch[0].indexOf("{") + 1;
    const start = bodyStart + specifier.index + (specifier[1]?.length ?? 0);
    const end = bodyStart + specifier.index + specifier[0].length;
    return { start, end, replacement: "" };
  }
  return null;
}

/**
 * Remove a simple object-literal member, such as `primary: '#09f'`. Complex
 * expressions, getters, spreads, and multiline values are deliberately left
 * untouched because deleting them safely requires an AST printer.
 */
function objectMemberEdit(source: string, finding: Finding): TextEdit | null {
  const memberName = finding.evidence?.memberName;
  const exportName = finding.evidence?.exportName;
  if (typeof memberName !== "string") return null;

  let bounds = finding.location ? lineBounds(source, finding.location.start.line) : null;
  if (!bounds && typeof exportName === "string") {
    const lines = source.split("\n");
    const lineIndex = lines.findIndex((line) => new RegExp(`\\bexport\\s+(?:const|let|var)\\s+${exportName}\\s*=\\s*\\{`).test(line));
    if (lineIndex >= 0) bounds = lineBounds(source, lineIndex + 1);
  }
  if (!bounds) return null;
  const beforeObject = bounds.text.lastIndexOf("{");
  const afterObject = bounds.text.indexOf("}", beforeObject + 1);
  if (beforeObject < 0 || afterObject < 0) return null;
  const objectText = bounds.text.slice(beforeObject + 1, afterObject);
  const escaped = memberName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const property = new RegExp(`\\b${escaped}\\s*:\\s*(?:'[^'\\n]*'|"[^"\\n]*"|true|false|null|[-+]?\\d+(?:\\.\\d+)?)\\s*(,)?`);
  const match = property.exec(objectText);
  if (!match || match.index === undefined) return null;
  const trailingComma = match[2] ? match[0].length - 1 : match[0].length;
  return {
    start: bounds.start + beforeObject + 1 + match.index,
    end: bounds.start + beforeObject + 1 + match.index + trailingComma,
    replacement: "",
  };
}

type IfRegion = {
  condition: string;
  start: number;
  thenStart: number;
  thenEnd: number;
  elseStart?: number | undefined;
  elseEnd?: number | undefined;
  end: number;
};

function matchingDelimiter(source: string, start: number, open: string, close: string): number {
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    if (source[i] === open) depth++;
    else if (source[i] === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function findIfRegions(source: string): IfRegion[] {
  const regions: IfRegion[] = [];
  const matcher = /\bif\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(source))) {
    const openParen = source.indexOf("(", match.index);
    const closeParen = matchingDelimiter(source, openParen, "(", ")");
    if (closeParen < 0) continue;
    const thenOpen = source.indexOf("{", closeParen + 1);
    if (thenOpen < 0) continue;
    const thenClose = matchingDelimiter(source, thenOpen, "{", "}");
    if (thenClose < 0) continue;
    let end = thenClose + 1;
    let elseStart: number | undefined;
    let elseEnd: number | undefined;
    const afterThen = source.slice(end).match(/^\s*else\s*\{/);
    if (afterThen) {
      const elseOpen = end + afterThen[0].lastIndexOf("{");
      const elseClose = matchingDelimiter(source, elseOpen, "{", "}");
      if (elseClose >= 0) {
        elseStart = elseOpen + 1;
        elseEnd = elseClose;
        end = elseClose + 1;
      }
    }
    regions.push({
      condition: source.slice(openParen + 1, closeParen).trim(),
      start: match.index,
      thenStart: thenOpen + 1,
      thenEnd: thenClose,
      elseStart,
      elseEnd,
      end,
    });
  }
  return regions;
}

function conditionEdit(source: string, finding: Finding, used: Set<number>): TextEdit | null {
  const regions = findIfRegions(source);
  const value = finding.evidence?.conditionValue;
  const reason = finding.evidence?.reason;
  const candidate = regions.findIndex((region, index) => {
    if (used.has(index)) return false;
    if (value === true && region.condition === "true") return true;
    if (value === false && region.condition === "false") return true;
    if (reason === "unsat-path-then" && /^(?:false\s*&&|0\s*&&)/.test(region.condition)) return true;
    return false;
  });
  if (candidate < 0) return null;
  used.add(candidate);
  const region = regions[candidate]!;
  const isTrue = value === true;
  if (isTrue && region.elseStart !== undefined && region.elseEnd !== undefined) {
    return { start: region.start, end: region.end, replacement: source.slice(region.thenStart, region.thenEnd) };
  }
  if (!isTrue && region.elseStart !== undefined && region.elseEnd !== undefined) {
    return { start: region.start, end: region.end, replacement: source.slice(region.elseStart, region.elseEnd) };
  }
  if (isTrue) return { start: region.start, end: region.thenStart, replacement: "" };
  return { start: region.start, end: region.thenEnd + 1, replacement: "" };
}

function buildSourceEdits(source: string, file: string, findings: Finding[], force: boolean): TextEdit[] {
  const edits: TextEdit[] = [];
  const usedConditions = new Set<number>();
  for (const finding of findings) {
    const edit = finding.rule === "unused-export"
      ? (exportModifierEdit(source, finding) ?? (force ? forceExportEdit(source, finding) : null))
      : finding.rule === "unused-member"
        ? objectMemberEdit(source, finding)
        : finding.rule === "constant-condition"
          ? conditionEdit(source, finding, usedConditions)
          : null;
    if (edit) edits.push(edit);
    else console.error(`[Fixer] Skipping unsafe or unsupported source fix: ${finding.rule} in ${file}`);
  }
  edits.sort((a, b) => b.start - a.start);
  for (let i = 1; i < edits.length; i++) {
    const previous = edits[i - 1];
    const current = edits[i];
    if (previous && current && previous.start < current.end) edits.splice(i, 1);
  }
  return edits;
}

function applyEdits(source: string, edits: TextEdit[]): string {
  let result = source;
  for (const edit of edits) result = result.slice(0, edit.start) + edit.replacement + result.slice(edit.end);
  return result;
}

export async function applyFixes(report: AnalysisReport, rootDir: string, fixConfig?: boolean | FixConfig): Promise<number> {
  let fixesApplied = 0;
  const config = fixConfig ?? true;
  const minConfidence = getMinConfidence(config);
  const allowedRules = typeof config === "object" && config.rules ? new Set(config.rules) : DEFAULT_SAFE_RULES;
  const dryRun = typeof config === "object" && !!config.dryRun;
  const force = typeof config === "object" && !!config.force;

  const fixableFindings = report.findings.filter((finding) => {
    const confidence = CONFIDENCE_LEVELS[finding.confidence] ?? 0;
    return (force || confidence >= minConfidence) && isRequestedRule(allowedRules, finding.rule);
  });
  if (fixableFindings.length === 0) return 0;

  const findingsByFile = new Map<string, Finding[]>();
  for (const finding of fixableFindings) {
    const list = findingsByFile.get(finding.file) ?? [];
    list.push(finding);
    findingsByFile.set(finding.file, list);
  }

  for (const [file, findings] of findingsByFile) {
    const absolutePath = path.resolve(rootDir, file);
    if (dryRun) {
      console.error(`[Fixer] [Dry Run] Would fix ${findings.length} issues in ${file}`);
      fixesApplied += findings.length;
      continue;
    }

    if (file === "package.json" || file.endsWith("/package.json")) {
      const pkg = await readJsonFile<any>(absolutePath);
      if (!pkg) continue;
      let changed = false;
      for (const finding of findings) {
        if ((finding.rule === "unused-dependency" || finding.rule === "unused-dev-dependency") && finding.evidence?.package) {
          const section = finding.rule === "unused-dev-dependency" ? "devDependencies" : "dependencies";
          const packageName = finding.evidence.package as string;
          if (pkg[section]?.[packageName]) {
            delete pkg[section][packageName];
            changed = true;
            fixesApplied++;
          }
        }
      }
      if (changed) await fs.writeFile(absolutePath, JSON.stringify(pkg, null, 2) + "\n");
      continue;
    }

    if (findings.some((finding) => finding.rule === "unreachable-file")) {
      try {
        await fs.unlink(absolutePath);
        fixesApplied++;
      } catch {
        // The file may already have been removed by another finding.
      }
      continue;
    }

    const sourceFindings = findings.filter((finding) => finding.rule === "unused-export" || finding.rule === "unused-member" || finding.rule === "constant-condition");
    if (sourceFindings.length === 0) continue;
    const source = await fs.readFile(absolutePath, "utf8");
    const edits = buildSourceEdits(source, file, sourceFindings, force);
    if (edits.length === 0) continue;
    if (dryRun) continue;
    await fs.writeFile(absolutePath, applyEdits(source, edits));
    fixesApplied += edits.length;
  }

  return fixesApplied;
}
