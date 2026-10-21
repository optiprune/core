import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { analyze } from "../../src/index.js";

type Case = {
  name: string;
  source: string;
  expectedLogic: number;
  expectedMessage?: string;
};

const cases: Case[] = [
  {
    name: "compound-assignment",
    source: `export function run(initial) { let x = initial; x += 1; if (x === 1) return "then"; return "else"; }`,
    expectedLogic: 0,
  },
  {
    name: "unsupported-assignment-condition",
    source: `export function run() { let x = 0; if ((x = 1)) {} if (x === 0) return "then"; return "else"; }`,
    expectedLogic: 0,
  },
  {
    name: "unsupported-guard-write",
    source: `export function run() { let range = false; const line = "c8 ignore start"; if (line.includes("c8 ignore start")) range = true; if (range) return "then"; return "else"; }`,
    expectedLogic: 0,
  },
  {
    name: "iterable-break",
    source: `export function run() { let found = false; for (const value of [1]) { if (value) { found = true; break; } } if (found) return "then"; return "else"; }`,
    expectedLogic: 0,
  },
  {
    name: "nan-is-not-reflexive",
    source: `export function run() { if (NaN === NaN) return "then"; return "else"; }`,
    expectedLogic: 0,
  },
  {
    name: "bounded-loop-state",
    source: `export function run() { let x = 0; while (x < 10) x++; if (x === 4) return "then"; return "else"; }`,
    expectedLogic: 0,
  },
  {
    name: "try-state",
    source: `export function run() { let enabled = false; try { enabled = true; } catch {} if (enabled) return "then"; return "else"; }`,
    expectedLogic: 0,
  },
  {
    name: "switch-state",
    source: `export function run() { let enabled = false; switch (0) { case 0: enabled = true; break; default: enabled = false; } if (enabled) return "then"; return "else"; }`,
    expectedLogic: 0,
  },
  {
    name: "await-identities",
    source: `export async function run() { const first = await Promise.resolve(true); const second = await Promise.resolve(false); if (first && !second) return "then"; return "else"; }`,
    expectedLogic: 0,
  },
  {
    name: "random-identities",
    source: `export function run() { if (Math.random() < 0.5) { if (Math.random() >= 0.5) return "then"; } return "else"; }`,
    expectedLogic: 0,
  },
  {
    name: "loose-equality",
    source: `export function run() { if (0 == false) return "then"; else return "else"; }`,
    expectedLogic: 2,
  },
  {
    name: "lexical-shadowing",
    source: `export function run() { let x = 0; { let x = 1; void x; } if (x === 0) return "then"; return "else"; }`,
    expectedLogic: 0,
  },
  {
    name: "var-in-block-mutates-outer-scope",
    source: `export function run() { var x = 0; { var x = 1; } if (x === 0) return "dead"; return "live"; }`,
    expectedLogic: 1,
  },
  {
    name: "switch-break-inside-for-of",
    source: `export function run() { let x = 0; for (const v of [1]) { switch (v) { case 1: x = 1; break; } } if (x === 2) return "dead"; return "live"; }`,
    // The outer iterable remains conservative because the case may not run.
    expectedLogic: 0,
  },
  {
    name: "division-by-zero-compound-assignment",
    source: `export function run() { let x = 10; x /= 0; if (x === 10) return "then"; return "else"; }`,
    expectedLogic: 0,
  },
  {
    name: "zero-division-produces-unknown-nan",
    source: `export function run() { let x = 0; x /= 0; if (x === x) return "then"; return "else"; }`,
    expectedLogic: 0,
  },
  {
    name: "while-loop-with-unlabeled-break",
    source: `export function run() { let x = 0; while (x < 3) { x++; if (x === 1) break; } if (x === 3) return "then"; return "else"; }`,
    expectedLogic: 0,
  },
  {
    name: "try-traversal",
    source: `export function run() { let x = 1; try { if (x > 2) return "dead"; } catch {} return "live"; }`,
    expectedLogic: 1,
    expectedMessage: "Logical path is mathematically unreachable (Always False).",
  },
  {
    name: "switch-traversal",
    source: `export function run() { let x = 1; switch (0) { case 0: if (x > 2) return "dead"; return "live"; default: return "other"; } }`,
    expectedLogic: 1,
    expectedMessage: "Logical path is mathematically unreachable (Always False).",
  },
  {
    name: "try-catch-sees-possible-try-mutation",
    source: `export function run() { let x = 0; try { x = 1; throw new Error("x"); } catch { if (x === 1) return "recovered"; } return "live"; }`,
    expectedLogic: 0,
  },
  {
    name: "switch-fallthrough-sees-prior-case-mutation",
    source: `export function run(tag) { let x = 0; switch (tag) { case 1: x = 1; case 2: if (x === 1) return "fell-through"; break; default: break; } return "live"; }`,
    expectedLogic: 0,
  },
];

async function analyzeCase(testCase: Case) {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "optiprune-layer3-hardening-"));
  try {
    await writeFile(path.join(rootDir, "input.mjs"), testCase.source);
    const report = await analyze({
      rootDir,
      entry: ["input.mjs"],
      extensions: [".mjs"],
      includeConventionalEntries: false,
      reportUnusedExports: false,
      skip4: true,
    });
    return report.findings.filter(
      (finding) => finding.rule === "constant-condition" || finding.rule === "contradictory-guard",
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
}

describe("Layer 3 soundness hardening regressions", () => {
  for (const testCase of cases) {
    it(`${testCase.name}: preserves sound logic conclusions`, async () => {
      const findings = await analyzeCase(testCase);
      expect(findings).toHaveLength(testCase.expectedLogic);
      if (testCase.expectedMessage) expect(findings[0]?.message).toBe(testCase.expectedMessage);
    });
  }
});
