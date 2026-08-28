import fs from "node:fs/promises";
import os from "node:os";
import path from "pathe";
import { afterEach, describe, expect, it } from "vitest";
import { analyze } from "../../src/index.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function fixture(dependencies: Record<string, string>, source: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "optiprune-ai-runtime-"));
  roots.push(root);
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ dependencies }, null, 2));
  await fs.writeFile(path.join(root, "src", "index.ts"), source, "utf8");
  return root;
}

async function inspect(dependencies: Record<string, string>, source: string, plugin: string) {
  const root = await fixture(dependencies, source);
  return analyze({
    rootDir: root,
    entry: ["src/index.ts"],
    includeConventionalEntries: false,
    skip3: true,
    skip4: true,
    plugins: { [plugin]: true },
  });
}

function findingRules(report: Awaited<ReturnType<typeof analyze>>): string[] {
  return report.findings.map((finding) => finding.rule);
}

describe("AI runtime plugins", () => {
  it("reports TensorFlow.js tensors without tidy or disposal, but accepts tidy and tf.dispose", async () => {
    const unsafe = await inspect({ "@tensorflow/tfjs": "^4.0.0" }, `
      import * as tf from "@tensorflow/tfjs";
      export function run() { const tensor = tf.tensor([1, 2]); return tensor; }
    `, "tensorflowjs-plugin");
    expect(findingRules(unsafe)).toContain("tfjs-undisposed-tensor");

    const safe = await inspect({ "@tensorflow/tfjs": "^4.0.0" }, `
      import * as tf from "@tensorflow/tfjs";
      export function run() { const tensor = tf.tensor([1, 2]); tf.dispose(tensor); return tf.tidy(() => tf.tensor([3])); }
    `, "tensorflowjs-plugin");
    expect(findingRules(safe)).not.toContain("tfjs-undisposed-tensor");
  });

  it("reports ONNX sessions and tensors that are not released and accepts finally-based session release", async () => {
    const unsafe = await inspect({ "onnxruntime-node": "^1.0.0" }, `
      import * as ort from "onnxruntime-node";
      export async function run() { const session = await ort.InferenceSession.create("model.onnx"); const input = new ort.Tensor("float32", new Float32Array(1)); return session.run({ input }); }
    `, "onnxruntime-node-plugin");
    expect(findingRules(unsafe)).toEqual(expect.arrayContaining(["onnx-unreleased-session", "onnx-unreleased-tensor"]));

    const safe = await inspect({ "onnxruntime-node": "^1.0.0" }, `
      import * as ort from "onnxruntime-node";
      export async function run() { const session = await ort.InferenceSession.create("model.onnx"); try { return session.run({}); } finally { await session.release(); } }
    `, "onnxruntime-node-plugin");
    expect(findingRules(safe)).not.toContain("onnx-unreleased-session");
    expect(findingRules(safe)).not.toContain("onnx-session-release-not-finally");
  });

  it("reports Transformers.js pipeline creation only in a loop or request handler", async () => {
    const report = await inspect({ "@huggingface/transformers": "^3.0.0" }, `
      import { pipeline } from "@huggingface/transformers";
      export async function create() { for (const value of [1, 2]) await pipeline("sentiment-analysis"); }
      export async function handler(req: Request) { return pipeline("text-classification"); }
    `, "transformersjs-plugin");
    expect(report.findings.filter((finding) => finding.rule === "transformers-pipeline-hot-path")).toHaveLength(2);
  });

  it("reports unbounded Vercel AI tool loops and request streams lacking onError", async () => {
    const report = await inspect({ ai: "^4.0.0" }, `
      import { generateText, streamText } from "ai";
      export async function tools() { return generateText({ model: "demo", tools: {} }); }
      export async function handler(req: Request) { return streamText({ model: "demo", tools: {} }); }
    `, "vercel-ai-sdk-plugin");
    expect(findingRules(report)).toEqual(expect.arrayContaining(["ai-sdk-unbounded-tool-loop", "ai-sdk-stream-no-error-handler"]));
  });

  it("accepts bounded Vercel AI tool loops and streams with onError", async () => {
    const report = await inspect({ ai: "^4.0.0" }, `
      import { generateText, streamText } from "ai";
      export async function tools() { return generateText({ model: "demo", tools: {}, maxSteps: 4 }); }
      export async function handler(req: Request) { return streamText({ model: "demo", tools: {}, stopWhen: "bound", onError() {} }); }
    `, "vercel-ai-sdk-plugin");
    expect(findingRules(report)).not.toContain("ai-sdk-unbounded-tool-loop");
    expect(findingRules(report)).not.toContain("ai-sdk-stream-no-error-handler");
  });

  it("reports direct user-looking prompt interpolation and graph invocations without recursionLimit", async () => {
    const report = await inspect({ "@langchain/core": "^0.0.0", "@langchain/langgraph": "^0.0.0" }, `
      import { ChatPromptTemplate } from "@langchain/core/prompts";
      import { StateGraph } from "@langchain/langgraph";
      const graphBuilder = new StateGraph({});
      const graph = graphBuilder.compile();
      export async function run(userInput: string) {
        const prompt = ChatPromptTemplate.fromTemplate(\`Rules: \${userInput}\`);
        return graph.invoke({ prompt });
      }
    `, "langchainjs-plugin");
    expect(findingRules(report)).toEqual(expect.arrayContaining(["langchain-direct-prompt-interpolation", "langgraph-missing-recursion-limit"]));
  });

  it("accepts a parameterized LangChain prompt with an explicit LangGraph recursionLimit", async () => {
    const report = await inspect({ "@langchain/core": "^0.0.0", "@langchain/langgraph": "^0.0.0" }, `
      import { ChatPromptTemplate } from "@langchain/core/prompts";
      import { StateGraph } from "@langchain/langgraph";
      const graphBuilder = new StateGraph({});
      const graph = graphBuilder.compile();
      export async function run(userInput: string) {
        const prompt = ChatPromptTemplate.fromTemplate("Rules: {userInput}");
        return graph.invoke({ prompt, userInput }, { recursionLimit: 8 });
      }
    `, "langchainjs-plugin");
    expect(findingRules(report)).not.toContain("langchain-direct-prompt-interpolation");
    expect(findingRules(report)).not.toContain("langgraph-missing-recursion-limit");
  });
});
