import path from "pathe";
import * as yaml from "js-yaml";
import type { AnalyzerPlugin, PluginAdapter } from "../types.js";
import { packageIsDeclared } from "./package-plugin-utils.js";

const PACKAGE = "borp";

// Borp reads YAML, rather than a JavaScript/TypeScript `borp.config.*` module.
// It checks these files in its process working directory, unless BORP_CONF_FILE
// specifies a YAML file explicitly.
const CONFIG_BASENAMES = [".borp.yaml", ".borp.yml"];
const DEFAULT_TEST_PATTERNS = [
  "**/*.test.js",
  "**/*.test.mjs",
  "**/*.test.cjs",
  "**/*.test.ts",
  "**/*.test.mts",
  "**/*.test.cts",
];
const BUILT_IN_REPORTERS = new Set(["gh", "tap", "spec", "dot", "junit"]);
const OPTIONS_WITH_VALUES = new Set([
  "--pattern",
  "-p",
  "--concurrency",
  "-c",
  "--timeout",
  "-t",
  "--coverage-exclude",
  "-X",
  "--ignore",
  "-i",
  "--reporter",
  "-r",
  "--lines",
  "--branches",
  "--functions",
  "--statements",
]);

type BorpConfig = {
  files: string[];
  reporters: string[];
};

type BorpInvocation = {
  files: string[];
  pattern?: string;
  configPaths: string[];
};

type BorpConfigFile = {
  file: string;
  // A discovered .borp.* file is read from its workspace working directory;
  // a BORP_CONF_FILE path is read explicitly while Borp keeps the script cwd.
  resolvesFromConfigDirectory: boolean;
};

function normalize(fileId: string): string {
  return fileId.replace(/\\/g, "/");
}

function isBorpConfigFile(fileId: string): boolean {
  return CONFIG_BASENAMES.includes(path.basename(normalize(fileId)));
}

function isBorpPackage(specifier: unknown): boolean {
  return typeof specifier === "string" && (specifier === PACKAGE || specifier.startsWith(`${PACKAGE}/`));
}

function packageNameFromSpecifier(specifier: string): string | undefined {
  if (!specifier || specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("node:")) {
    return undefined;
  }
  if (specifier.startsWith("@")) {
    const [scope, name] = specifier.split("/");
    return scope && name ? `${scope}/${name}` : undefined;
  }
  return specifier.split("/")[0];
}

function staticPath(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed && !trimmed.includes("$") && !trimmed.includes("`") ? trimmed : undefined;
}

/**
 * Split simple shell command chains while retaining quoted arguments. Looking
 * only at a segment's executable avoids treating incidental text such as
 * `echo borp` as evidence that Borp is installed or run.
 */
function shellSegments(command: string): string[][] {
  const segments: string[][] = [];
  let segment: string[] = [];
  let token = "";
  let quote: "'" | '"' | undefined;
  let escaped = false;

  const pushToken = () => {
    if (token) segment.push(token);
    token = "";
  };
  const pushSegment = () => {
    pushToken();
    if (segment.length > 0) segments.push(segment);
    segment = [];
  };

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index] ?? "";
    if (escaped) {
      token += character;
      escaped = false;
    } else if (character === "\\" && quote !== "'") {
      escaped = true;
    } else if (quote) {
      if (character === quote) quote = undefined;
      else token += character;
    } else if (character === "'" || character === '"') {
      quote = character;
    } else if (/\s/.test(character)) {
      pushToken();
    } else if (character === ";" || character === "|" || character === "&") {
      if ((character === "|" || character === "&") && command[index + 1] === character) index += 1;
      pushSegment();
    } else {
      token += character;
    }
  }
  pushSegment();
  return segments;
}

function isEnvironmentAssignment(token: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=/.test(token);
}

function commandStart(tokens: string[]): number {
  let index = 0;
  while (isEnvironmentAssignment(tokens[index] ?? "")) index += 1;
  if (tokens[index] === "env" || tokens[index] === "cross-env") {
    index += 1;
    while ((tokens[index] ?? "").startsWith("-") || isEnvironmentAssignment(tokens[index] ?? "")) {
      index += 1;
    }
  }
  return index;
}

function wrappedBorpIndex(tokens: string[], start: number): number | undefined {
  const runner = tokens[start];
  if (!runner) return undefined;

  let index: number;
  if (runner === "pnpm" || runner === "yarn") {
    const subcommand = tokens[start + 1];
    if (subcommand === PACKAGE) return start + 1;
    if (subcommand !== "exec" && subcommand !== "dlx") return undefined;
    index = start + 2;
  } else if (runner === "npx" || runner === "bunx") {
    index = start + 1;
  } else if (runner === "npm" && tokens[start + 1] === "exec") {
    index = start + 2;
  } else {
    return undefined;
  }

  while (index < tokens.length) {
    const token = tokens[index] ?? "";
    if (token === "--") return tokens[index + 1] === PACKAGE ? index + 1 : undefined;
    if (!token.startsWith("-")) return token === PACKAGE ? index : undefined;
    index += token === "--package" || token === "-p" ? 2 : 1;
  }
  return undefined;
}

function borpExecutableIndex(tokens: string[]): number | undefined {
  const start = commandStart(tokens);
  const executable = tokens[start];
  if (
    executable === PACKAGE ||
    executable === `./node_modules/.bin/${PACKAGE}` ||
    executable === `node_modules/.bin/${PACKAGE}`
  ) {
    return start;
  }
  return wrappedBorpIndex(tokens, start);
}

function invocationFromTokens(tokens: string[]): BorpInvocation | undefined {
  const executableIndex = borpExecutableIndex(tokens);
  if (executableIndex === undefined) return undefined;

  const files: string[] = [];
  let pattern: string | undefined;
  let positionalOnly = false;
  const args = tokens.slice(executableIndex + 1);
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index] ?? "";
    if (positionalOnly) {
      const target = staticPath(argument);
      if (target) files.push(target);
    } else if (argument === "--") {
      positionalOnly = true;
    } else if (argument === "--pattern" || argument === "-p") {
      pattern = staticPath(args[index + 1] ?? "");
      index += 1;
    } else if (argument.startsWith("--pattern=")) {
      pattern = staticPath(argument.slice("--pattern=".length));
    } else if (OPTIONS_WITH_VALUES.has(argument)) {
      index += 1;
    } else if (!argument.startsWith("-")) {
      const target = staticPath(argument);
      if (target) files.push(target);
    }
  }

  const configPaths = tokens
    .slice(0, executableIndex)
    .flatMap((token) => {
      const match = token.match(/^BORP_CONF_FILE=(.+)$/);
      const configPath = match?.[1] && /\.ya?ml$/i.test(match[1]) ? staticPath(match[1]) : undefined;
      return configPath ? [configPath] : [];
    });

  return { files, ...(pattern && { pattern }), configPaths };
}

function findBorpInvocations(packageJson: any): Array<{ scriptName: string; invocation: BorpInvocation }> {
  const result: Array<{ scriptName: string; invocation: BorpInvocation }> = [];
  for (const [scriptName, script] of Object.entries(packageJson?.scripts ?? {})) {
    if (typeof script !== "string") continue;
    for (const tokens of shellSegments(script)) {
      const invocation = invocationFromTokens(tokens);
      if (invocation) result.push({ scriptName, invocation });
    }
  }
  return result;
}

async function findConfigFiles(
  adapter: PluginAdapter,
  invocations: Array<{ scriptName: string; invocation: BorpInvocation }>,
): Promise<BorpConfigFile[]> {
  const defaultFiles = new Set(await adapter.findFiles(CONFIG_BASENAMES));
  for (const configName of CONFIG_BASENAMES) {
    if (await adapter.folderExists(configName)) defaultFiles.add(configName);
  }

  const explicitFiles = new Set<string>();
  for (const { invocation } of invocations) {
    for (const configPath of invocation.configPaths) {
      if (await adapter.folderExists(configPath)) explicitFiles.add(configPath);
    }
  }

  return [...new Set([...defaultFiles, ...explicitFiles])]
    .map((file) => ({ file, resolvesFromConfigDirectory: !explicitFiles.has(file) }))
    .sort((left, right) => left.file.localeCompare(right.file));
}

function parseConfig(source: string): BorpConfig {
  try {
    const value = yaml.load(source);
    if (!value || typeof value !== "object" || Array.isArray(value)) return { files: [], reporters: [] };
    const config = value as Record<string, unknown>;
    return {
      files: Array.isArray(config.files)
        ? config.files.filter((file): file is string => typeof file === "string")
        : [],
      reporters: Array.isArray(config.reporters)
        ? config.reporters.filter((reporter): reporter is string => typeof reporter === "string")
        : [],
    };
  } catch {
    return { files: [], reporters: [] };
  }
}

async function addBorpEntryPatterns(adapter: PluginAdapter, patterns: string[]): Promise<void> {
  const positive = patterns.filter((pattern) => !pattern.startsWith("!"));
  const ignored = patterns.filter((pattern) => pattern.startsWith("!")).map((pattern) => pattern.slice(1));
  if (positive.length === 0) return;
  if (ignored.length === 0) {
    adapter.addEntryPatterns(positive);
    return;
  }

  // Bang-prefixed `files` globs are Borp exclusions. The adapter accepts entry
  // patterns but has no exclusion companion, so pass only the verified files.
  const included = await adapter.findFilesByGlob(positive);
  const excluded = new Set(await adapter.findFilesByGlob(ignored));
  adapter.addEntryPatterns(included.filter((file) => !excluded.has(file)));
}

function resolveConfigWorkingDirectoryPath(
  configFile: BorpConfigFile,
  configuredPath: string,
): string {
  if (!configFile.resolvesFromConfigDirectory || path.isAbsolute(configuredPath)) return configuredPath;
  const bang = configuredPath.startsWith("!") ? "!" : "";
  const value = bang ? configuredPath.slice(1) : configuredPath;
  const directory = path.dirname(normalize(configFile.file));
  return directory === "." ? configuredPath : `${bang}${path.join(directory, value)}`;
}

function markConfiguredReporter(
  adapter: PluginAdapter,
  configFile: BorpConfigFile,
  reporter: string,
): void {
  const name = reporter.split(":", 1)[0]?.trim();
  if (!name || BUILT_IN_REPORTERS.has(name)) return;
  if (name.startsWith(".") || name.startsWith("/")) {
    // Default .borp.* config is read from its working directory. In contrast,
    // BORP_CONF_FILE only changes the config input; Borp still resolves local
    // reporters from the script's process.cwd().
    adapter.addEntryPatterns([resolveConfigWorkingDirectoryPath(configFile, name)]);
    return;
  }
  const packageName = packageNameFromSpecifier(name);
  if (packageName) adapter.markPackageAsUsed(packageName);
}

export const BorpPlugin: AnalyzerPlugin = {
  name: `${PACKAGE}-plugin`,
  version: "1.2.0",

  async detect(adapter) {
    const packageJson = await adapter.readJson("package.json");
    if (packageIsDeclared(packageJson, PACKAGE)) return true;
    if ((await findConfigFiles(adapter, [])).length > 0) return true;
    return findBorpInvocations(packageJson).length > 0;
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const packageJson = await adapter.readJson("package.json");
      const invocations = findBorpInvocations(packageJson);
      const configFiles = await findConfigFiles(adapter, invocations);
      const configuredTestPatterns: string[] = [];

      for (const configFile of configFiles) {
        // A config is protected from every file-local finding, but it is not an
        // application entry point and must therefore not be marked with markAsUsed.
        adapter.markConfigFileAsUsed(configFile.file);
        const source = await adapter.readFile(configFile.file);
        if (!source) continue;
        const config = parseConfig(source);
        configuredTestPatterns.push(
          ...config.files
            .map((file) => resolveConfigWorkingDirectoryPath(configFile, file.trim()))
            .filter(Boolean),
        );
        for (const reporter of config.reporters) markConfiguredReporter(adapter, configFile, reporter);
      }

      const positionalTestPatterns = [
        ...configuredTestPatterns,
        ...invocations.flatMap((entry) => entry.invocation.files),
      ];
      for (const { scriptName } of invocations) {
        adapter.markAsUsed("package.json", `scripts:${scriptName}`);
      }
      await addBorpEntryPatterns(adapter, positionalTestPatterns);

      // Borp uses --pattern only when it has no positional files. Configured
      // `files` are appended as positional arguments, so they take precedence.
      const patternTestPatterns =
        positionalTestPatterns.length === 0
          ? invocations.flatMap((entry) => (entry.invocation.pattern ? [entry.invocation.pattern] : []))
          : [];
      await addBorpEntryPatterns(adapter, patternTestPatterns);
      if (
        (configFiles.length > 0 || invocations.length > 0) &&
        positionalTestPatterns.length === 0 &&
        patternTestPatterns.length === 0
      ) {
        // `borp` auto-discovers this precise test-name family when no files or
        // --pattern are supplied; these are real runner entry points.
        await addBorpEntryPatterns(adapter, DEFAULT_TEST_PATTERNS);
      }

      const hasRuntimeEvidence = configFiles.length > 0 || invocations.length > 0;
      if (hasRuntimeEvidence && packageIsDeclared(packageJson, PACKAGE)) {
        adapter.markPackageAsUsed(PACKAGE);
      } else if (hasRuntimeEvidence) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message: "Borp configuration or command found, but 'borp' is not listed in package.json.",
          evidence: { configFiles: configFiles.map((configFile) => configFile.file), scripts: invocations.map((entry) => entry.scriptName) },
        });
      }
    },

    onFileStart: (fileId, adapter) => {
      if (isBorpConfigFile(fileId)) adapter.markConfigFileAsUsed(fileId);
    },

    onASTNode: (node, fileId, adapter) => {
      const source =
        node?.type === "ImportDeclaration" ||
        node?.type === "ExportNamedDeclaration" ||
        node?.type === "ExportAllDeclaration"
          ? node.source?.value
          : node?.type === "CallExpression" &&
              (node.callee?.name === "require" || node.callee?.type === "Import")
            ? node.arguments?.[0]?.value
            : undefined;
      if (isBorpPackage(source)) adapter.markPackageAsUsed(PACKAGE);
    },
  },
};

export default BorpPlugin;
