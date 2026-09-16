import {
  createConnection,
  Diagnostic,
  InitializeParams,
  InitializeResult,
  ProposedFeatures,
  TextDocuments,
  TextDocumentSyncKind,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { URI } from "vscode-uri";
import { analyze } from "./index.js";
import type { Finding } from "./types.js";
import { findingDiagnostic } from "./language-server-utils.js";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);
let workspaceRoot: string | undefined;
let analysisTimer: NodeJS.Timeout | undefined;
let analysisInFlight = false;
let analysisQueued = false;

function uriToPath(uri: string): string {
  return URI.parse(uri).fsPath;
}

function pathToUri(filePath: string): string {
  return URI.file(resolve(filePath)).toString();
}

function rootFromParams(params: InitializeParams): string {
  const rootUri = params.rootUri ?? params.workspaceFolders?.[0]?.uri;
  return rootUri ? uriToPath(rootUri) : process.cwd();
}

function readEntries(rootDir: string): string[] | undefined {
  const packagePath = join(rootDir, "package.json");
  if (!existsSync(packagePath)) return undefined;
  try {
    const pkg = JSON.parse(readFileSync(packagePath, "utf8")) as {
      optiprune?: { entry?: string[] };
    };
    return pkg.optiprune?.entry;
  } catch {
    return undefined;
  }
}

async function publishDiagnostics(): Promise<void> {
  if (!workspaceRoot) return;
  if (analysisInFlight) {
    analysisQueued = true;
    return;
  }
  analysisInFlight = true;
  try {
    const entries = readEntries(workspaceRoot);
    const report = await analyze({
      rootDir: workspaceRoot,
      ...(entries ? { entry: entries } : {}),
      output: "json",
      reportUnusedExports: true,
      includeEntryExports: true,
    });
    const byFile = new Map<string, Diagnostic[]>();
    for (const finding of report.findings) {
      const absolute = resolve(workspaceRoot, finding.file);
      const uri = pathToUri(absolute);
      const list = byFile.get(uri) ?? [];
      list.push(findingDiagnostic(finding));
      byFile.set(uri, list);
    }

    const openUris = new Set(documents.all().map((document) => document.uri));
    for (const uri of new Set([...byFile.keys(), ...openUris])) {
      await connection.sendDiagnostics({ uri, diagnostics: byFile.get(uri) ?? [] });
    }
    connection.console.info(`OptiPrune analyzed ${report.findings.length} finding(s).`);
  } catch (error) {
    connection.console.error(`OptiPrune analysis failed: ${String(error)}`);
  } finally {
    analysisInFlight = false;
    if (analysisQueued) {
      analysisQueued = false;
      void publishDiagnostics();
    }
  }
}

function scheduleAnalysis(): void {
  if (analysisTimer) clearTimeout(analysisTimer);
  analysisTimer = setTimeout(() => void publishDiagnostics(), 350);
}

connection.onInitialize((params): InitializeResult => {
  workspaceRoot = rootFromParams(params);
  return {
    capabilities: {
      textDocumentSync: {
        openClose: true,
        change: TextDocumentSyncKind.Incremental,
        save: { includeText: false },
      },
      workspaceSymbolProvider: false,
    },
    serverInfo: { name: "OptiPrune Language Server", version: "0.1.0" },
  };
});

connection.onInitialized(() => scheduleAnalysis());
documents.onDidOpen(() => scheduleAnalysis());
documents.onDidChangeContent(() => scheduleAnalysis());
documents.onDidSave(() => scheduleAnalysis());
documents.onDidClose((event) =>
  connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] }),
);

connection.onShutdown(() => {
  if (analysisTimer) clearTimeout(analysisTimer);
});

documents.listen(connection);
connection.listen();
