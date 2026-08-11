import { promises as fs } from "node:fs";
import path from "pathe";
import { AnalysisReport, Finding, FixConfig, Confidence } from "./types.js";
import { readJsonFile } from "./fs-utils.js";

const CONFIDENCE_LEVELS: Record<string, number> = {
  'low': 1,
  'medium': 2,
  'high': 3,
  'info': 0,
};

function getMinConfidence(config: FixConfig | boolean): number {
  if (typeof config === 'boolean') return 3; // Default to high confidence for boolean 'true'
  
  switch (config.confidence) {
    case 'all': return 0;
    case 'low+': return 1;
    case 'medium+': return 2;
    case 'high': return 3;
    default: return 3;
  }
}

export async function applyFixes(report: AnalysisReport, rootDir: string, fixConfig?: boolean | FixConfig): Promise<number> {
  let fixesApplied = 0;
  const config = fixConfig ?? true;
  const minConfidence = getMinConfidence(config);
  const allowedRules = typeof config === 'object' && config.rules ? new Set(config.rules) : null;
  const dryRun = typeof config === 'object' && !!config.dryRun;

  // Filter findings based on confidence and rules
  const fixableFindings = report.findings.filter(finding => {
    // 1. Check confidence
    const confidenceVal = CONFIDENCE_LEVELS[finding.confidence] ?? 0;
    if (confidenceVal < minConfidence) return false;

    // 2. Check rules
    if (allowedRules) {
      // Map user-friendly names to internal rules
      if (allowedRules.has('exports') && (finding.rule === 'unused-export' || finding.rule === 'unused-member')) return true;
      if (allowedRules.has('files') && finding.rule === 'unreachable-file') return true;
      if (allowedRules.has('dependencies') && (finding.rule === 'unused-dependency' || finding.rule === 'unused-dev-dependency')) return true;
      
      // Direct rule match
      if (allowedRules.has(finding.rule)) return true;
      
      return false;
    }

    return true;
  });

  if (fixableFindings.length === 0) return 0;

  // Group findings by file to minimize file operations
  const findingsByFile = new Map<string, Finding[]>();
  for (const finding of fixableFindings) {
    const fileFindings = findingsByFile.get(finding.file) || [];
    fileFindings.push(finding);
    findingsByFile.set(finding.file, fileFindings);
  }

  // To prevent removing exports in files that are going to be deleted
  const filesToDelete = new Set(
    fixableFindings
      .filter(f => f.rule === "unreachable-file")
      .map(f => path.resolve(rootDir, f.file))
  );

  for (const [file, findings] of findingsByFile.entries()) {
    const absolutePath = path.resolve(rootDir, file);
    
    if (dryRun) {
      console.log(`[Fixer] [Dry Run] Would fix ${findings.length} issues in ${file}`);
      fixesApplied += findings.length;
      continue;
    }

    if (file === "package.json" || file.endsWith("/package.json")) {
      // Handle package.json fixes (unused dependencies)
      const pkg = await readJsonFile<any>(absolutePath);
      if (pkg) {
        let changed = false;
        for (const finding of findings) {
          if ((finding.rule === "unused-dependency" || finding.rule === "unused-dev-dependency") && finding.evidence?.package) {
            const pkgName = finding.evidence.package as string;
            const type = finding.rule === "unused-dev-dependency" ? "devDependencies" : "dependencies";
            if (pkg[type] && pkg[type][pkgName]) {
              delete pkg[type][pkgName];
              changed = true;
              fixesApplied++;
            }
          }
        }
        if (changed) {
          await fs.writeFile(absolutePath, JSON.stringify(pkg, null, 2) + "\n");
        }
      }
    } else if (findings.some(f => f.rule === "unreachable-file")) {
      // Handle unreachable files (delete them)
      try {
        await fs.unlink(absolutePath);
        fixesApplied++;
      } catch (e) {
        // Ignore if file already deleted
      }
    } else if (!filesToDelete.has(absolutePath)) {
      // Handle source file fixes (exports, members)
      // Only if the file itself isn't slated for deletion
      
      let source = await fs.readFile(absolutePath, "utf8");
      let lines = source.split("\n");
      let changed = false;
      
      // Sort findings by line number descending to avoid offset issues
      const sourceFindings = findings
        .filter(f => (f.rule === "unused-export" || f.rule === "unused-member") && f.location)
        .sort((a, b) => (b.location!.start.line || 0) - (a.location!.start.line || 0));
        
      for (const finding of sourceFindings) {
        const lineIdx = (finding.location!.start.line || 0) - 1;
        if (lineIdx >= 0 && lineIdx < lines.length) {
          const line = lines[lineIdx] || "";
          const exportName = finding.evidence.exportName as string;
          
          if (finding.rule === "unused-export") {
            // Refined export removal: strip 'export ' but keep the declaration
            // This is safer than deleting the whole line as it might be used locally.
            if (line.includes("export ") && (exportName ? line.includes(exportName) : true)) {
              lines[lineIdx] = line.replace("export ", "");
              fixesApplied++;
              changed = true;
            }
          } else if (finding.rule === "unused-member") {
            // For unused members of an object/class, we just comment them out for now
            // as full AST-based removal is risky without a proper parser/printer.
            const memberName = finding.evidence.memberName as string;
            if (line.includes(memberName)) {
              lines[lineIdx] = `// optiprune-fix: ${line}`;
              fixesApplied++;
              changed = true;
            }
          }
        }
      }
      
      if (changed) {
        await fs.writeFile(absolutePath, lines.join("\n"));
      }
    }
  }

  return fixesApplied;
}
