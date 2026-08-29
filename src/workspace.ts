import path from "pathe";
import fs from "node:fs";
import fg from "fast-glob";
import * as yaml from "js-yaml";
import { normalizeAbsolute, normalizeCanonicalPath, readJsonFile } from "./fs-utils.js";
import type { WorkspacePackage, MonorepoGraph } from "./types.js";

/**
 * Resolves all sub-packages in a Monorepo workspace.
 * Uses POSIX-style path logic for internal calculations to support Windows.
 */
export async function buildMonorepoTopology(
  rootPath: string,
  pluginWorkspaceGlobs: string[] = [],
  discoveryIgnoreGlobs: string[] = [],
): Promise<MonorepoGraph> {
  const absoluteRoot = normalizeAbsolute(rootPath);
  const packageMap = new Map<string, WorkspacePackage>();

  const packageGlobs: string[] = [...pluginWorkspaceGlobs];

  // 1. Detect pnpm-workspace.yaml
  const pnpmWorkspacePath = path.join(absoluteRoot, "pnpm-workspace.yaml");
  if (fs.existsSync(pnpmWorkspacePath)) {
    try {
      const content = fs.readFileSync(pnpmWorkspacePath, "utf-8");
      const doc = yaml.load(content) as any;
      if (doc?.packages && Array.isArray(doc.packages)) {
        packageGlobs.push(...doc.packages);
      }
    } catch (e) {
      // Ignore parse warnings on malformed workspace configs
    }
  }

  // 2. Detect Yarn/NPM workspaces in package.json
  const rootPackageJsonPath = path.join(absoluteRoot, "package.json");
  if (fs.existsSync(rootPackageJsonPath)) {
    const rootManifest = await readJsonFile<Record<string, any>>(rootPackageJsonPath);
    if (rootManifest) {
      if (Array.isArray(rootManifest.workspaces)) {
        packageGlobs.push(...rootManifest.workspaces);
      } else if (
        rootManifest.workspaces?.packages &&
        Array.isArray(rootManifest.workspaces.packages)
      ) {
        packageGlobs.push(...rootManifest.workspaces.packages);
      }
    }
  }

  // 3. Detect Bun workspaces from bun.lock (text version)
  const bunLockPath = path.join(absoluteRoot, "bun.lock");
  if (fs.existsSync(bunLockPath)) {
    try {
      const lockContent = fs.readFileSync(bunLockPath, "utf-8");
      const cleanJson = lockContent.replace(/,(\s*[\]}])/g, "$1");
      const lock = JSON.parse(cleanJson);
      if (lock.workspaces && typeof lock.workspaces === "object") {
        for (const relPath of Object.keys(lock.workspaces)) {
          if (relPath !== "") {
            packageGlobs.push(relPath);
          }
        }
      }
    } catch (e) {
      // Ignore parse errors
    }
  }

  const uniquePackageGlobs = Array.from(
    new Set(packageGlobs.filter((glob) => typeof glob === "string" && glob.trim().length > 0)),
  );

  // Default to common patterns if nothing found
  if (uniquePackageGlobs.length === 0) {
    packageGlobs.push("packages/*", "apps/*");
  }

  // 3. Find all package.json files matching the globs
  let manifestFiles = await fg(
    (uniquePackageGlobs.length > 0 ? uniquePackageGlobs : packageGlobs).map((g) =>
      path.posix.join(g, "package.json"),
    ),
    { cwd: absoluteRoot, absolute: true, ignore: ["**/node_modules/**", ...discoveryIgnoreGlobs] },
  );

  // Auto-discovery: If no packages found via standard globs, search for any package.json
  if (manifestFiles.length === 0) {
    manifestFiles = await fg("**/package.json", {
      cwd: absoluteRoot,
      absolute: true,
      ignore: ["**/node_modules/**", "package.json", ...discoveryIgnoreGlobs],
    });
  }

  for (const manifestPath of manifestFiles) {
    const manifest = await readJsonFile<Record<string, any>>(manifestPath);
    if (!manifest || !manifest.name) continue;

    const pkgName = manifest.name as string;
    const location = normalizeAbsolute(path.dirname(manifestPath));
    const allDeps = new Set<string>([
      ...Object.keys(manifest.dependencies || {}),
      ...Object.keys(manifest.devDependencies || {}),
      ...Object.keys(manifest.peerDependencies || {}),
    ]);

    packageMap.set(pkgName, {
      name: pkgName,
      location,
      relativePath: path.posix.relative(absoluteRoot, location),
      manifestPath: normalizeAbsolute(manifestPath),
      dependencies: new Set(),
      allDependencies: allDeps,
    });
  }

  // 4. Resolve internal workspace dependencies
  const internalPackageNames = new Set(packageMap.keys());
  for (const pkg of packageMap.values()) {
    for (const depName of pkg.allDependencies) {
      if (internalPackageNames.has(depName)) {
        pkg.dependencies.add(depName);
      }
    }
  }

  // 5. Topological Sort
  const topologicalOrder: string[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  function visit(name: string) {
    if (visiting.has(name)) return;
    if (visited.has(name)) return;

    visiting.add(name);
    const pkg = packageMap.get(name);
    if (pkg) {
      for (const dep of pkg.dependencies) {
        visit(dep);
      }
    }
    visiting.delete(name);
    visited.add(name);
    topologicalOrder.push(name);
  }

  for (const name of packageMap.keys()) {
    visit(name);
  }

  return {
    rootPath: absoluteRoot,
    packageMap,
    topologicalOrder,
  };
}
