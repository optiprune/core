import { promises as fs } from "node:fs";
import path from "pathe";
import { AnalysisReport, Finding } from "./types.js";
import { readJsonFile } from "./fs-utils.js";

export async function applyFixes(report: AnalysisReport, rootDir: string): Promise<number> {
  let fixesApplied = 0;
  
  // Group findings by file to minimize file operations
  const findingsByFile = new Map<string, Finding[]>();
  for (const finding of report.findings) {
    const fileFindings = findingsByFile.get(finding.file) || [];
    fileFindings.push(finding);
    findingsByFile.set(finding.file, fileFindings);
  }

  for (const [file, findings] of findingsByFile.entries()) {
    const absolutePath = path.resolve(rootDir, file);
    
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
    } else if (findings.some(f => f.rule === "unused-export" && f.location)) {
      // Handle unused exports (remove them from source)
      // This is more complex, for now we'll do a simple line-based removal if possible
      // or just mark it as something to be improved.
      // A real fixer would use AST transformations.
      
      let source = await fs.readFile(absolutePath, "utf8");
      const lines = source.split("\n");
      
      // Sort findings by line number descending to avoid offset issues
      const exportFindings = findings
        .filter(f => f.rule === "unused-export" && f.location)
        .sort((a, b) => (b.location!.start.line || 0) - (a.location!.start.line || 0));
        
      for (const finding of exportFindings) {
        const lineIdx = (finding.location!.start.line || 0) - 1;
        if (lineIdx >= 0 && lineIdx < lines.length) {
          const line = lines[lineIdx] || "";
          // Simple heuristic: if the line contains 'export', comment it out or remove it
          if (line.includes("export ")) {
            lines[lineIdx] = `// optiprune-fix: ${line}`;
            fixesApplied++;
          }
        }
      }
      
      await fs.writeFile(absolutePath, lines.join("\n"));
    }
  }

  return fixesApplied;
}
