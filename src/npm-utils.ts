// npm-utils.ts

const PACKAGE_CACHE = new Map<string, boolean>();

/**
 * Extracts the base package name from a module specifier or subpath.
 * Handles scoped packages:
 *   "@nx/devkit/testing" -> "@nx/devkit"
 *   "lodash/get"         -> "lodash"
 */
export function extractBasePackageName(specifier: string): string | null {
  if (
    !specifier ||
    specifier.startsWith(".") ||
    specifier.startsWith("/") ||
    specifier.startsWith("#")
  ) {
    return null;
  }
  if (specifier.startsWith("@")) {
    const parts = specifier.split("/");
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : specifier;
  }
  return specifier.split("/")[0] || null;
}

/**
 * Checks whether an npm package exists.
 * 1. Checks local node_modules (instant).
 * 2. Caches results to prevent duplicate lookups.
 * 3. Falls back to registry HEAD request.
 */
export async function verifyPackageExists(pkgName: string, adapter: any): Promise<boolean> {
  if (!pkgName) return true;
  if (PACKAGE_CACHE.has(pkgName)) return PACKAGE_CACHE.get(pkgName)!;

  // 1. Fast check: Check if installed in root node_modules
  const localExists = await adapter.folderExists(`node_modules/${pkgName}`);
  if (localExists) {
    PACKAGE_CACHE.set(pkgName, true);
    return true;
  }

  // 2. Query NPM registry for uninstalled / hallucinated / typo packages
  try {
    const encoded = pkgName.replace("/", "%2f");
    const response = await fetch(`https://registry.npmjs.org/${encoded}`, {
      method: "HEAD",
      headers: { Accept: "application/vnd.npm.install-v1+json" },
    });

    const exists = response.status === 200;
    PACKAGE_CACHE.set(pkgName, exists);
    return exists;
  } catch {
    // If offline or network error, assume true to prevent false error spam
    return true;
  }
}
