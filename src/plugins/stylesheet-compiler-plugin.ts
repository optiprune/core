import path from "pathe";
import type { AnalyzerPlugin } from "../types.js";

const STYLE_GLOB = ["**/*.css", "**/*.scss", "**/*.sass", "**/*.less", "**/*.styl", "**/*.stylus"];
const STYLE_EXTENSIONS = /\.(?:css|scss|sass|less|styl|stylus)$/i;

function packageName(specifier: string): string | undefined {
  if (specifier === "tailwindcss") return specifier;
  const isExplicitPackage = specifier.startsWith("~") || specifier.startsWith("pkg:") || specifier.startsWith("@");
  if (!isExplicitPackage) return;
  const value = specifier.replace(/^~/, "").replace(/^pkg:/, "");
  if (!value || value.startsWith(".") || value.startsWith("/") || /^[a-z]+:/i.test(value)) return;
  const parts = value.split("/");
  return value.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

function relativeAsset(specifier: string): boolean {
  return specifier.startsWith(".") || specifier.startsWith("/");
}

export const StylesheetCompilerPlugin: AnalyzerPlugin = {
  name: "stylesheet-compiler-plugin",
  version: "1.0.0",
  detect: async (adapter) => (await adapter.findFilesByGlob(STYLE_GLOB)).length > 0,
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      const allDeps = { ...pkg?.dependencies, ...pkg?.devDependencies, ...pkg?.peerDependencies };
      for (const compiler of ["sass", "less", "stylus", "postcss", "tailwindcss"]) {
        if (allDeps[compiler]) adapter.markPackageAsUsed(compiler);
      }
      const styles = await adapter.findFilesByGlob(STYLE_GLOB);
      const assets = await adapter.findFilesByGlob(["**/*.jpg", "**/*.jpeg", "**/*.png", "**/*.gif", "**/*.svg", "**/*.webp"]);
      const referenced = new Set<string>();
      for (const style of styles) {
        const source = await adapter.readFile(style);
        if (!source) continue;
        const scanText = source.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
        for (const match of scanText.matchAll(/url\(\s*["']?([^"'\s)]+)["']?\s*\)/gi)) {
          const specifier = match[1];
          if (!specifier || !relativeAsset(specifier)) continue;
          referenced.add(path.resolve(path.dirname(style), specifier));
        }
      }
      for (const asset of assets) {
        if (!referenced.has(path.resolve(asset))) {
          adapter.emitFinding({ rule: "unreachable-file", severity: "warning", confidence: "high", file: asset, message: "File is not reachable from any stylesheet asset reference.", evidence: {} });
        }
      }
    },
    onFileStart: async (fileId, adapter) => {
      if (!STYLE_EXTENSIONS.test(fileId)) return;
      const source = await adapter.readFile(fileId);
      if (source === null) return;
      const scanText = source.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));

      const importPattern = /@(?:import|use|forward|plugin|require)\s*(?:\([^)]*\)\s*)*(?:url\(\s*)?["']?([^"'\s)]+)["']?\s*\)?/gi;
      for (const match of scanText.matchAll(importPattern)) {
        const specifier = match[1];
        if (!specifier) continue;
        const pkg = packageName(specifier);
        if (pkg) adapter.markPackageAsUsed(pkg);
        else if (relativeAsset(specifier)) adapter.markRelativeFileAsUsed(fileId, specifier);
      }

      const urlPattern = /url\(\s*["']?([^"'\s)]+)["']?\s*\)/gi;
      for (const match of scanText.matchAll(urlPattern)) {
        const specifier = match[1];
        if (specifier && relativeAsset(specifier)) {
          adapter.markRelativeFileAsUsed(fileId, specifier);
        }
      }
    },
  },
};

export default StylesheetCompilerPlugin;
