import type { PluginAdapter } from "../types.js";

export function packageIsDeclared(pkg: any, packageName: string): boolean {
  const dependencies = {
    ...(pkg?.dependencies ?? {}),
    ...(pkg?.devDependencies ?? {}),
    ...(pkg?.peerDependencies ?? {}),
    ...(pkg?.optionalDependencies ?? {}),
  };
  return packageName in dependencies;
}

export function markDeclaredPackage(adapter: PluginAdapter, packageName: string): void {
  adapter.markPackageAsUsed(packageName);
  adapter.markAsUsed("package.json", `dependency:${packageName}`);
}
