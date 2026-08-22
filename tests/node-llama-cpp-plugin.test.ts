import fs from "node:fs/promises";
import os from "node:os";
import path from "pathe";
import { afterEach, describe, expect, it } from "vitest";
import { analyze } from "../src/index.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function rootWith(source: string, includeDependency = true): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "optiprune-node-llama-cpp-"));
  roots.push(root);
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify({
    ...(includeDependency && { dependencies: { "node-llama-cpp": "^3.0.0" } }),
  }, null, 2));
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.writeFile(path.join(root, "src", "index.ts"), source, "utf8");
  return root;
}

async function analyzeLlamaSource(source: string) {
  const root = await rootWith(source);
  return analyze({
    rootDir: root,
    entry: ["src/index.ts"],
    includeConventionalEntries: false,
    plugins: { "node-llama-cpp-plugin": true },
    skip3: true,
    skip4: true,
  });
}

function rules(report: Awaited<ReturnType<typeof analyze>>): string[] {
  return report.findings.map((finding) => finding.rule);
}

const imports = 'import { getLlama, LlamaChatSession } from "node-llama-cpp";';
const setup = `
  const llama = await getLlama();
  const model = await llama.loadModel({ modelPath: "model.gguf" });
`;

describe("node-llama-cpp plugin", () => {
  it("accepts a context whose session lineage is request-local and disposed in finally", async () => {
    const report = await analyzeLlamaSource(`${imports}
      export async function handle(req: { body: string }) {
        ${setup}
        const context = await model.createContext({ contextSize: 2048, batchSize: 512, sequences: 2 });
        try {
          const session = new LlamaChatSession({ contextSequence: context.getSequence() });
          return await session.prompt(req.body);
        } finally {
          await context.dispose();
        }
      }
    `);

    expect(rules(report)).not.toContain("node-llama-missing-disposal");
    expect(rules(report)).not.toContain("node-llama-disposal-not-finally");
    expect(rules(report)).not.toContain("node-llama-shared-sequence");
  });

  it("reports a context that is never disposed", async () => {
    const report = await analyzeLlamaSource(`${imports}
      export async function createSession() {
        ${setup}
        const context = await model.createContext();
        return new LlamaChatSession({ contextSequence: context.getSequence() });
      }
    `);

    const finding = report.findings.find((candidate) => candidate.rule === "node-llama-missing-disposal");
    expect(finding).toMatchObject({
      severity: "warning",
      confidence: "high",
      evidence: { context: "context" },
    });
  });

  it("reports disposal outside a finally block", async () => {
    const report = await analyzeLlamaSource(`${imports}
      export async function answer() {
        ${setup}
        const context = await model.createContext();
        const session = new LlamaChatSession({ contextSequence: context.getSequence() });
        const answer = await session.prompt("hello");
        await context.dispose();
        return answer;
      }
    `);

    expect(rules(report)).toContain("node-llama-disposal-not-finally");
    expect(rules(report)).not.toContain("node-llama-missing-disposal");
  });

  it("reports a module-scoped session reused by a request handler", async () => {
    const report = await analyzeLlamaSource(`${imports}
      ${setup}
      const context = await model.createContext({ sequences: 1 });
      const session = new LlamaChatSession({ contextSequence: context.getSequence() });
      const app = { post(_path: string, handler: (req: { body: string }, res: unknown) => unknown) { return handler; } };
      app.post("/chat", async (req, res) => session.prompt(req.body));
    `);

    const finding = report.findings.find((candidate) => candidate.rule === "node-llama-shared-sequence");
    expect(finding).toMatchObject({
      severity: "warning",
      confidence: "high",
      evidence: { session: "session", configuredSequences: 1 },
    });
  });

  it("does not report a session allocated from context.getSequence inside each request handler", async () => {
    const report = await analyzeLlamaSource(`${imports}
      ${setup}
      const context = await model.createContext({ sequences: 2 });
      const app = { post(_path: string, handler: (req: { body: string }, res: unknown) => unknown) { return handler; } };
      app.post("/chat", async (req, res) => {
        const session = new LlamaChatSession({ contextSequence: context.getSequence() });
        return session.prompt(req.body);
      });
    `);

    expect(rules(report)).not.toContain("node-llama-shared-sequence");
  });

  it("audits invalid and unsafe createContext options", async () => {
    const report = await analyzeLlamaSource(`${imports}
      export async function create() {
        ${setup}
        const context = await model.createContext({
          contextSize: 512,
          batchSize: 1024,
          sequences: 0,
          ignoreMemorySafetyChecks: true,
        });
        return context;
      }
    `);

    expect(rules(report)).toEqual(expect.arrayContaining([
      "node-llama-batch-exceeds-context",
      "node-llama-invalid-sequences",
      "node-llama-memory-safety-disabled",
    ]));
  });

  it("keeps same-named contexts isolated across function scopes", async () => {
    const report = await analyzeLlamaSource(`${imports}
      export async function safe() {
        ${setup}
        const context = await model.createContext({ contextSize: 1024, batchSize: 512 });
        try { return context; } finally { await context.dispose(); }
      }
      export async function unsafe() {
        ${setup}
        const context = await model.createContext({ contextSize: 256, batchSize: 512 });
        return context;
      }
    `);

    const batchFindings = report.findings.filter((candidate) => candidate.rule === "node-llama-batch-exceeds-context");
    const disposalFindings = report.findings.filter((candidate) => candidate.rule === "node-llama-missing-disposal");
    expect(batchFindings).toHaveLength(1);
    expect(disposalFindings).toHaveLength(1);
    expect(disposalFindings[0]?.evidence.scope).toContain("unsafe");
  });

  it("activates automatically when node-llama-cpp is declared in package.json", async () => {
    const root = await rootWith(`${imports}
      export async function create() {
        ${setup}
        const context = await model.createContext();
        return context;
      }
    `);
    const report = await analyze({
      rootDir: root,
      entry: ["src/index.ts"],
      includeConventionalEntries: false,
      skip3: true,
      skip4: true,
    });

    expect(rules(report)).toContain("node-llama-missing-disposal");
  });

  it("reports an imported node-llama-cpp package missing from package.json", async () => {
    const root = await rootWith(`${imports}
      export async function create() {
        ${setup}
        return model.createContext();
      }
    `, false);
    const report = await analyze({
      rootDir: root,
      entry: ["src/index.ts"],
      includeConventionalEntries: false,
      skip3: true,
      skip4: true,
    });

    expect(report.findings.find((finding) => finding.rule === "missing-dependency")).toMatchObject({
      severity: "error",
      confidence: "high",
      evidence: { package: "node-llama-cpp", importedFrom: expect.stringContaining("src/index.ts") },
    });
  });
});
