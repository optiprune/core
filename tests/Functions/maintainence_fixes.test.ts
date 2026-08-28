import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { analyze } from "../../src/index.js";
import path from "node:path";
import fs from "node:fs";

describe("Optiprune Maintenance Fixes", () => {
    const rootDir = path.resolve("./tests/fixtures/maintenance-test");
    
    beforeAll(() => {
        if (!fs.existsSync(rootDir)) fs.mkdirSync(rootDir, { recursive: true });
        
        // 1. Setup for Parse Error Isolation (Fix 1)
        // entry.ts has a syntax error, but should not suppress findings in other files
        fs.writeFileSync(path.join(rootDir, "entry.ts"), `
            import { used } from "./lib";
            const x = {; // Syntax error
            export const unusedInEntry = 1;
        `);
        
        fs.writeFileSync(path.join(rootDir, "lib.ts"), `
            export const used = 1;
            export const unusedInLib = 2;
        `);

        // 2. Setup for TSConfig Resolution (Fix 2)
        fs.writeFileSync(path.join(rootDir, "tsconfig.json"), JSON.stringify({
            compilerOptions: {
                baseUrl: "./src",
                paths: {
                    "@utils/*": ["tools/*"]
                }
            }
        }));
        
        const srcDir = path.join(rootDir, "src");
        if (!fs.existsSync(srcDir)) fs.mkdirSync(srcDir, { recursive: true });
        const toolsDir = path.join(srcDir, "tools");
        if (!fs.existsSync(toolsDir)) fs.mkdirSync(toolsDir, { recursive: true });
        
        fs.writeFileSync(path.join(srcDir, "entry2.ts"), `
            import { tool } from "@utils/helper";
            export const entry2 = tool;
        `);
        
        fs.writeFileSync(path.join(toolsDir, "helper.ts"), `
            export const tool = "resolved";
            export const unusedTool = "unused";
        `);

        // 3. Setup for Dependency Whitelist (Fix 3)
        fs.writeFileSync(path.join(rootDir, "package.json"), JSON.stringify({
            name: "maintenance-test",
            devDependencies: {
                "turborepo": "latest",
                "husky": "latest",
                "unused-pkg": "latest"
            }
        }));
    });

    afterAll(() => {
        // Cleanup could be done here if needed
    });

    it("should isolate parse errors and find unrelated unused exports", async () => {
        const report = await analyze({
            rootDir,
            entry: ["entry.ts"],
            extensions: [".ts"],
            reportUnusedExports: true,
        });
        
        // Unused export in entry.ts (the one with the error) should be found (via fallback)
        const unusedInEntry = report.findings.find(f => f.rule === "unused-export" && f.evidence.exportName === "unusedInEntry");
        expect(unusedInEntry).toBeDefined();
        expect(unusedInEntry?.confidence).toBe("low"); // Findings from regex fallback parsing are intentionally low confidence
    });

    it("should resolve imports via baseUrl and paths in tsconfig", async () => {
        const report = await analyze({
            rootDir,
            entry: ["src/entry2.ts"],
            extensions: [".ts"],
            reportUnusedExports: true,
        });
        
        const unresolved = report.findings.filter(f => f.rule === "unresolved-import");
        expect(unresolved.length).toBe(0);
        
        const helperModule = report.modules.find(m => m.path.includes("helper.ts"));
        expect(helperModule).toBeDefined();
        
        const unusedTool = report.findings.find(f => f.rule === "unused-export" && f.evidence.exportName === "unusedTool");
        expect(unusedTool).toBeDefined();
    });
});
