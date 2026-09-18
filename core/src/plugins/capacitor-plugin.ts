import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const CAPACITOR_CONFIG_FILES = [
  "capacitor.config.json",
  "capacitor.config.ts",
  "capacitor.config.js",
  "capacitor.config.cjs",
  "capacitor.config.mjs",
];

const CAPACITOR_LIFECYCLE_METHODS = new Set([
  "load",
  "handleOnStart",
  "handleOnResume",
  "handleOnPause",
  "handleOnStop",
  "handleOnDestroy",
  "checkPermissions",
  "requestPermissions",
  "removeAllListeners",
  "addListener",
]);

function lineLocation(line: number) {
  return { start: { line, column: 0 }, end: { line, column: 0 } };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function processCapacitorConfig(config: Record<string, any>, adapter: any): void {
  if (!config || typeof config !== "object") return;

  if (typeof config.webDir === "string" && !config.webDir.includes("*")) {
    adapter.markAsUsed(config.webDir);
  }

  if (config.plugins && typeof config.plugins === "object") {
    for (const pluginKey of Object.keys(config.plugins)) {
      const possiblePkg = `@capacitor/${pluginKey.toLowerCase()}`;
      adapter.markPackageAsUsed(possiblePkg);
    }
  }
}

async function inspectNativeBridge(adapter: any): Promise<void> {
  const globFiles: string[] = await adapter
    .findFilesByGlob(["**/*", "*"])
    .catch(async () => adapter.findFilesByGlob(["**/*"]));
  const allFiles = [...new Set(globFiles)];

  const nativeFiles = allFiles.filter(
    (file: string) =>
      /(?:^|[/\\])(?:android|ios)[/\\]/.test(file) && /\.(kt|java|swift)$/.test(file),
  );
  if (nativeFiles.length === 0) return;

  const allJsFiles = allFiles.filter(
    (file: string) =>
      /\.(js|mjs|ts|tsx)$/.test(file) &&
      !/\.d\.ts\.map$/.test(file) &&
      !/(?:^|[/\\])(?:android|ios)[/\\]/.test(file),
  );

  const jsSourceEntries = (
    await Promise.all(
      allJsFiles.map(async (file: string) => [file, await adapter.readFile(file)] as const),
    )
  ).filter((entry): entry is readonly [string, string] => Boolean(entry[1]));

  const nativeSources = new Map<string, string>();
  for (const file of nativeFiles) {
    const source = await adapter.readFile(file);
    if (source) nativeSources.set(file, source);
  }

  // --- 1. Identify Registered Bridge Interfaces & Contract Methods ---
  const contractInterfaces = new Set<string>();
  for (const [, source] of jsSourceEntries) {
    for (const match of source.matchAll(/registerPlugin\s*<\s*([A-Za-z0-9_$]+)\s*>/g)) {
      if (match[1]) contractInterfaces.add(match[1]);
    }
  }

  // Map: methodName -> { file: string, line: number }
  const declaredContractMethods = new Map<string, { file: string; line: number }>();

  for (const [file, source] of jsSourceEntries) {
    // If interface name is explicitly registered
    for (const iface of contractInterfaces) {
      const ifaceRegex = new RegExp(
        `(?:interface|type)\\s+${escapeRegex(iface)}[^{]*\\{([\\s\\S]*?)\\}`,
        "g",
      );
      for (const ifaceMatch of source.matchAll(ifaceRegex)) {
        const body = ifaceMatch[1] ?? "";
        const bodyOffset = (ifaceMatch.index ?? 0) + ifaceMatch[0].indexOf(body);
        for (const m of body.matchAll(/(?:^|\n|\r|;)\s*([A-Za-z0-9_$]+)\s*(?:\([^)]*\)|:)/g)) {
          const methodName = m[1];
          if (methodName && !CAPACITOR_LIFECYCLE_METHODS.has(methodName)) {
            const line = source.slice(0, bodyOffset + (m.index ?? 0)).split(/\r?\n/).length;
            declaredContractMethods.set(methodName, { file, line });
          }
        }
      }
    }

    // Generic fallback for Plugin/Bridge contract interfaces
    const genericIfaceRegex =
      /(?:export\s+)?(?:interface|type)\s+([A-Za-z0-9_$]*(?:Plugin\vert{}Bridge\vert{}Contract)[A-Za-z0-9_$]*)[^{]*\{([\s\S]*?)\}/g;
    for (const ifaceMatch of source.matchAll(genericIfaceRegex)) {
      const body = ifaceMatch[2] ?? "";
      const bodyOffset = (ifaceMatch.index ?? 0) + ifaceMatch[0].indexOf(body);
      for (const m of body.matchAll(/(?:^|\n|\r|;)\s*([A-Za-z0-9_$]+)\s*(?:\([^)]*\)|:)/g)) {
        const methodName = m[1];
        if (
          methodName &&
          !CAPACITOR_LIFECYCLE_METHODS.has(methodName) &&
          !declaredContractMethods.has(methodName)
        ) {
          const line = source.slice(0, bodyOffset + (m.index ?? 0)).split(/\r?\n/).length;
          declaredContractMethods.set(methodName, { file, line });
        }
      }
    }
  }

  // Sanitize executable consumer JS code
  const nonDefinitionEntries = jsSourceEntries.filter(
    ([file]) => !/definition/i.test(file.replace(/\\/g, "/")),
  );

  const consumerCode = (nonDefinitionEntries.length > 0 ? nonDefinitionEntries : jsSourceEntries)
    .map(([, src]) =>
      src
        .replace(/(?:export\s+)?(?:interface|type)\s+[A-Za-z0-9_$]+[^{]*\{[\s\S]*?\}/g, "")
        .replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, ""),
    )
    .join("\n");

  // --- 2. Event Channel Audit ---
  const declaredEvents = new Set<string>();
  const emittedEvents = new Set<string>();

  for (const source of nativeSources.values()) {
    for (const match of source.matchAll(/notifyListeners\s*\(\s*["']([^"']+)["']/g)) {
      if (match[1]) emittedEvents.add(match[1]);
    }
  }

  for (const [, source] of jsSourceEntries) {
    for (const match of source.matchAll(/addListener\s*(?:<[^>]+>)?\s*\(\s*["']([^"']+)["']/g)) {
      if (match[1]) declaredEvents.add(match[1]);
    }
  }

  for (const event of declaredEvents) {
    if (!emittedEvents.has(event)) {
      const escaped = escapeRegex(event);
      const listenerRegex = new RegExp(`addListener\\s*(?:<[^>]+>)?\\s*\\(\\s*["']${escaped}["']`);
      adapter.emitFinding({
        rule: "capacitor-untriggered-event",
        severity: "warning",
        confidence: "medium",
        file:
          jsSourceEntries.find(([, source]) => listenerRegex.test(source))?.[0] ??
          allJsFiles[0] ??
          "package.json",
        message: `Capacitor event '${event}' has listeners but no native notifyListeners emission.`,
        evidence: { event, source: "capacitor-bridge" },
      });
    }
  }

  for (const event of emittedEvents) {
    if (!declaredEvents.has(event)) {
      const file =
        [...nativeSources.entries()].find(
          ([, source]) => source.includes(`"${event}"`) || source.includes(`'${event}'`),
        )?.[0] ?? nativeFiles[0];
      adapter.emitFinding({
        rule: "capacitor-orphaned-event",
        severity: "warning",
        confidence: "high",
        file,
        message: `Native Capacitor event '${event}' has no matching TypeScript listener declaration.`,
        evidence: { event, source: "capacitor-bridge" },
      });
    }
  }

  // --- 3. Bridge Method Audits ---
  const allNativeConcatenated = [...nativeSources.values()].join("\n");
  const processedMethods = new Set<string>();

  // A. Check methods implemented on native side
  for (const [file, source] of nativeSources) {
    const isSwift = file.endsWith(".swift");
    const nativeMethods: { name: string; line: number }[] = [];

    if (isSwift) {
      const swiftPattern =
        /@objc(?:\([^)]*\))?\s+(?:public\s+|internal\s+)?(?:func|class func)\s+([A-Za-z0-9_$]+)/g;
      for (const match of source.matchAll(swiftPattern)) {
        if (match[1]) {
          const line = source.slice(0, match.index ?? 0).split(/\r?\n/).length;
          nativeMethods.push({ name: match[1], line });
        }
      }
    } else {
      const jvmPattern =
        /@PluginMethod\s*(?:\([^)]*\))?[\s\S]*?(?:fun\s+|void\s+|[\w<>?\[\]]+\s+)([A-Za-z0-9_$]+)\s*\(/g;
      for (const match of source.matchAll(jvmPattern)) {
        if (match[1]) {
          const line = source.slice(0, match.index ?? 0).split(/\r?\n/).length;
          nativeMethods.push({ name: match[1], line });
        }
      }
    }

    for (const { name: method, line } of nativeMethods) {
      if (CAPACITOR_LIFECYCLE_METHODS.has(method)) continue;
      processedMethods.add(method);

      const escapedMethod = escapeRegex(method);
      const declaredInPublicApi = declaredContractMethods.has(method);
      const isInvoked = new RegExp(`\\.\\s*${escapedMethod}\\s*\\(`).test(consumerCode);

      if (!isInvoked) {
        const message = declaredInPublicApi
          ? `Capacitor phantom bridge method '${method}' is declared in contract but never invoked by consumer code.`
          : `Native Capacitor method '${method}' is not declared or referenced by the JavaScript API.`;

        adapter.emitFinding({
          rule: "capacitor-orphaned-native-method",
          severity: "warning",
          confidence: "high",
          file,
          location: lineLocation(line),
          message,
          evidence: { method, source: "capacitor-annotation", declaredInPublicApi },
        });
      }
    }

    // Native internal dead helper check
    const privatePattern = isSwift ? /private\s+func\s+(\w+)/g : /private\s+fun\s+(\w+)/g;
    for (const match of source.matchAll(privatePattern)) {
      const method = match[1];
      if (!method || CAPACITOR_LIFECYCLE_METHODS.has(method)) continue;

      const prefix = source.slice(Math.max(0, (match.index ?? 0) - 80), match.index ?? 0);
      if (prefix.includes("@PluginMethod")) continue;

      const escapedMethod = escapeRegex(method);
      const nativeCallMatches = allNativeConcatenated.match(
        new RegExp(`\\b${escapedMethod}\\b`, "g"),
      );
      if (!nativeCallMatches || nativeCallMatches.length <= 1) {
        const line = source.slice(0, match.index ?? 0).split(/\r?\n/).length;
        adapter.emitFinding({
          rule: "capacitor-orphaned-native-method",
          severity: "warning",
          confidence: "high",
          file,
          location: lineLocation(line),
          message: `Native Capacitor private helper '${method}' is dead code and never invoked natively.`,
          evidence: { method, source: "capacitor-private-helper" },
        });
      }
    }
  }

  // B. Check methods declared in TS contract interfaces that were not implemented or invoked
  for (const [method, meta] of declaredContractMethods.entries()) {
    if (processedMethods.has(method)) continue;

    const escapedMethod = escapeRegex(method);
    const isInvoked = new RegExp(`\\.\\s*${escapedMethod}\\s*\\(`).test(consumerCode);

    if (!isInvoked) {
      adapter.emitFinding({
        rule: "capacitor-orphaned-native-method",
        severity: "warning",
        confidence: "high",
        file: meta.file,
        location: lineLocation(meta.line),
        message: `Capacitor phantom bridge method '${method}' is declared in contract but never invoked by consumer code.`,
        evidence: { method, source: "capacitor-contract", declaredInPublicApi: true },
      });
    }
  }

  // --- 4. Build Manifest & Compilation Wiring Audit ---
  const explicitWiringFiles = allFiles.filter(
    (file: string) =>
      /(?:^|[/\\])(?:android|ios)[/\\]/.test(file) &&
      /\.(podspec|gradle|gradle\.kts|podspec\.json)$/.test(file),
  );

  const conventionalWiringFiles = [
    "android/build.gradle",
    "android/build.gradle.kts",
    "ios/Manifest.podspec",
  ];

  const wiringFiles = [...new Set([...explicitWiringFiles, ...conventionalWiringFiles])];
  const wiringSources = (
    await Promise.all(
      wiringFiles.map(async (file) => ({
        file: file.replace(/\\/g, "/"),
        content: (await adapter.readFile(file)) ?? "",
      })),
    )
  ).filter((entry) => entry.content.length > 0);

  if (wiringSources.length === 0) return;

  const androidWiring = wiringSources
    .filter((entry) => entry.file.includes("android/"))
    .map((entry) => entry.content)
    .join("\n");

  const iosWiring = wiringSources
    .filter((entry) => entry.file.includes("ios/"))
    .map((entry) => entry.content)
    .join("\n");

  const pkg = await adapter.readJson("package.json").catch(() => null);
  const hasCapacitorConfigOrManifest = Boolean(
    pkg?.capacitor || (await adapter.folderExists("capacitor.config.json").catch(() => false)),
  );

  for (const file of nativeFiles) {
    const normalizedFile = file.replace(/\\/g, "/");
    const base = path.basename(normalizedFile);
    if (/(Plugin|Main)\.(swift|kt|java)$/.test(base)) continue;

    const isIos = normalizedFile.includes("ios/");
    const targetWiring = isIos ? iosWiring : androidWiring;
    if (!targetWiring) continue;

    const usesWildcardWiring = isIos
      ? /source_files\s*=.*(\*|\{.*\}|Classes|Sources)/.test(targetWiring) ||
        hasCapacitorConfigOrManifest
      : /srcDirs\s*\(?.*(src\/main|src\/.*\/java|src\/.*\/kotlin|main\.java)/.test(targetWiring) ||
        /sourceSets\s*\{/.test(targetWiring) ||
        hasCapacitorConfigOrManifest;

    if (!usesWildcardWiring && !targetWiring.includes(base)) {
      adapter.emitFinding({
        rule: "capacitor-uncompiled-native-file",
        severity: "warning",
        confidence: "medium",
        file,
        message: `Native file '${base}' is not referenced by the iOS podspec or Android Gradle source wiring.`,
        evidence: { source: "capacitor-manifest-wiring" },
      });
    }
  }
}

export const CapacitorPlugin: AnalyzerPlugin = {
  name: "capacitor-plugin",
  version: "1.0.0",

  detect: async (adapter) => {
    for (const configFile of CAPACITOR_CONFIG_FILES) {
      try {
        if (await adapter.folderExists(configFile)) return true;
      } catch {}
    }

    try {
      const pkg = await adapter.readJson("package.json");
      if (pkg) {
        const allDeps = {
          ...(pkg.dependencies || {}),
          ...(pkg.devDependencies || {}),
          ...(pkg.peerDependencies || {}),
        };

        if (
          Object.keys(allDeps).some(
            (dep) => dep.startsWith("@capacitor/") || dep.startsWith("capacitor-"),
          )
        ) {
          return true;
        }

        if (pkg.scripts && typeof pkg.scripts === "object") {
          const scriptValues = Object.values(pkg.scripts);
          if (
            scriptValues.some(
              (s) =>
                typeof s === "string" &&
                (/\bcap\b/.test(s) || /\bcapacitor\b/.test(s) || s.includes("npx cap")),
            )
          ) {
            return true;
          }
        }
      }
    } catch {}

    if (
      (await adapter.folderExists("android").catch(() => false)) ||
      (await adapter.folderExists("ios").catch(() => false))
    ) {
      return true;
    }

    return false;
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      try {
        const pkg = await adapter.readJson("package.json");

        for (const configFile of CAPACITOR_CONFIG_FILES) {
          if (await adapter.folderExists(configFile).catch(() => false)) {
            adapter.markAsUsed(configFile);
          }
        }

        if (await adapter.folderExists("android").catch(() => false)) {
          adapter.markAsUsed("android");
        }
        if (await adapter.folderExists("ios").catch(() => false)) {
          adapter.markAsUsed("ios");
        }

        if (pkg?.scripts) {
          for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
            if (
              typeof scriptContent === "string" &&
              (/\bcap\b/.test(scriptContent) ||
                /\bcapacitor\b/.test(scriptContent) ||
                scriptContent.includes("npx cap"))
            ) {
              adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            }
          }
        }

        if (await adapter.folderExists("capacitor.config.json").catch(() => false)) {
          const configData = await adapter.readJson("capacitor.config.json").catch(() => null);
          if (configData) {
            processCapacitorConfig(configData, adapter);
          }
        }
      } catch {}

      await inspectNativeBridge(adapter);
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      if (CAPACITOR_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
      }

      if (
        normalized.includes("/android/") ||
        normalized.startsWith("android/") ||
        normalized.includes("/ios/") ||
        normalized.startsWith("ios/")
      ) {
        adapter.markAsUsed(fileId);
      }
    },

    onASTNode: (node: any, fileId: string, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      if (
        basename.startsWith("capacitor.config.") &&
        (basename.endsWith(".ts") ||
          basename.endsWith(".js") ||
          basename.endsWith(".cjs") ||
          basename.endsWith(".mjs"))
      ) {
        if (t.isExportDefaultDeclaration(node)) {
          adapter.markAsUsed(fileId, "default");
        }

        if (
          t.isAssignmentExpression(node) &&
          t.isMemberExpression(node.left) &&
          t.isIdentifier(node.left.object) &&
          node.left.object.name === "module" &&
          t.isIdentifier(node.left.property) &&
          node.left.property.name === "exports"
        ) {
          adapter.markAsUsed(fileId);
        }

        if (
          t.isObjectProperty(node) &&
          t.isIdentifier(node.key) &&
          node.key.name === "webDir" &&
          t.isStringLiteral(node.value)
        ) {
          adapter.markAsUsed(node.value.value);
        }
      }

      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (source.startsWith("@capacitor/") || source.startsWith("capacitor-")) {
          adapter.markPackageAsUsed(source);
          adapter.markAsUsed(fileId);
        }
      }
    },
  },
};

export default CapacitorPlugin;
