import { describe, it, expect, beforeEach, afterEach } from "vitest"; // or '@jest/globals'
import fs from "node:fs/promises";
import path from "pathe";
import os from "node:os";
import { PluginEngine } from "../../src/engine.ts";
import { AnalysisContext } from "../../src/types.ts";

describe("PluginEngine Security - Path Traversal Boundary Tests", () => {
  let tempBaseDir: string;
  let rootDir: string;
  let outsideFile: string;
  let engine: PluginEngine;
  let mockContext: AnalysisContext;

  beforeEach(async () => {
    // 1. Create a sandboxed temporary directory tree
    // /tempBaseDir
    // ├── secret.txt          <-- OUTSIDE rootDir
    // └── workspace/          <-- rootDir
    //     ├── project.json    <-- INSIDE rootDir
    //     └── src/
    //         └── app.ts
    tempBaseDir = await fs.mkdtemp(path.join(os.tmpdir(), "engine-security-test-"));
    rootDir = path.join(tempBaseDir, "workspace");
    await fs.mkdir(rootDir, { recursive: true });
    await fs.mkdir(path.join(rootDir, "src"), { recursive: true });

    outsideFile = path.join(tempBaseDir, "secret.txt");
    await fs.writeFile(outsideFile, "SENSITIVE_API_KEY_12345", "utf8");

    await fs.writeFile(
      path.join(rootDir, "project.json"),
      JSON.stringify({ name: "my-app", status: "ok" }),
      "utf8"
    );

    engine = new PluginEngine();
    mockContext = {
      options: {
        rootDir,
        entry: [],
        ignore: [],
      },
      modules: new Map(),
    } as unknown as AnalysisContext;
  });

  afterEach(async () => {
    // Clean up temporary test files
    await fs.rm(tempBaseDir, { recursive: true, force: true });
  });

  describe("readFile() boundary checks", () => {
    it("reads valid files located inside rootDir", async () => {
      const adapter = engine.createAdapter(mockContext);
      const content = await adapter.readFile("project.json");
      expect(content).toContain("my-app");
    });

    it("blocks relative path traversal targeting files outside rootDir", async () => {
      const adapter = engine.createAdapter(mockContext);
      const content = await adapter.readFile("../secret.txt");
      expect(content).toBeNull();
    });

    it("blocks deep traversal patterns (e.g. ../../../etc/passwd)", async () => {
      const adapter = engine.createAdapter(mockContext);
      const content = await adapter.readFile("../../../../../../../../secret.txt");
      expect(content).toBeNull();
    });

    it("blocks absolute system paths outside rootDir", async () => {
      const adapter = engine.createAdapter(mockContext);
      const content = await adapter.readFile(outsideFile);
      expect(content).toBeNull();
    });
  });

  describe("readJson() boundary checks", () => {
    it("parses JSON files located inside rootDir", async () => {
      const adapter = engine.createAdapter(mockContext);
      const json = await adapter.readJson("project.json");
      expect(json).toEqual({ name: "my-app", status: "ok" });
    });

    it("blocks reading JSON outside rootDir via relative traversal", async () => {
      const sensitiveJson = path.join(tempBaseDir, "outside.json");
      await fs.writeFile(sensitiveJson, JSON.stringify({ token: "secret" }), "utf8");

      const adapter = engine.createAdapter(mockContext);
      const result = await adapter.readJson("../outside.json");
      expect(result).toBeNull();
    });

    it("blocks reading JSON via absolute path", async () => {
      const sensitiveJson = path.join(tempBaseDir, "outside.json");
      await fs.writeFile(sensitiveJson, JSON.stringify({ token: "secret" }), "utf8");

      const adapter = engine.createAdapter(mockContext);
      const result = await adapter.readJson(sensitiveJson);
      expect(result).toBeNull();
    });
  });

  describe("folderExists() boundary checks", () => {
    it("returns true for existing directories inside rootDir", async () => {
      const adapter = engine.createAdapter(mockContext);
      const exists = await adapter.folderExists("src");
      expect(exists).toBe(true);
    });

    it("returns false when probing directories outside rootDir via relative traversal", async () => {
      const adapter = engine.createAdapter(mockContext);
      // Probing parent directory
      const exists = await adapter.folderExists("..");
      expect(exists).toBe(false);
    });

    it("returns false when probing absolute system directories outside rootDir", async () => {
      const adapter = engine.createAdapter(mockContext);
      const exists = await adapter.folderExists(tempBaseDir);
      expect(exists).toBe(false);
    });
  });
});