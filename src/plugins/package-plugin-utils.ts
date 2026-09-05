import type { PluginAdapter } from "../types.js";

/**
 * Return whether a package is declared in any dependency section.
 *
 * Declaration is useful for plugin activation, but it is not proof that the
 * package is used. Generic package plugins must not promote declarations to
 * usage because that would hide real unused-dependency findings.
 */
export function packageIsDeclared(pkg: any, packageName: string): boolean {
  const dependencies = {
    ...(pkg?.dependencies ?? {}),
    ...(pkg?.devDependencies ?? {}),
    ...(pkg?.peerDependencies ?? {}),
    ...(pkg?.optionalDependencies ?? {}),
  };
  return packageName in dependencies;
}

/**
 * Mark a package only when a package-specific plugin has independently
 * observed usage. This generic helper intentionally does nothing; declaration
 * alone is not evidence of usage. Keep it as a compatibility shim for the
 * dedicated package plugins until each plugin supplies its own usage signal.
 */
export function markDeclaredPackage(_adapter: PluginAdapter, _packageName: string): void {
  // Intentionally empty. See the function documentation above.
}
