import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function getNativeBindingNames(): string[] {
  try {
    const yukuCorePackage = require("yuku-core/package.json") as {
      optionalDependencies?: Record<string, string>;
    };
    return Object.keys(yukuCorePackage.optionalDependencies ?? {})
      .filter((name) => name.startsWith("@yuku-core/binding-"))
      .map((name) => name.slice("@yuku-core/binding-".length));
  } catch {
    return [];
  }
}

export function isRunningInWebContainer(): boolean {
  return (
    process.env.SHELL === "/bin/jsh" ||
    Boolean(process.env.STACKBLITZ) ||
    typeof globalThis.window !== "undefined" ||
    typeof (globalThis as Record<string, unknown>).WorkerGlobalScope !== "undefined" ||
    Boolean(process.versions && "webcontainer" in process.versions)
  );
}

export function isMuslLinux(): boolean {
  if (process.platform !== "linux") return false;

  try {
    const report = process.report?.getReport?.() as
      | { header?: { glibcVersionRuntime?: string }; sharedObjects?: string[] }
      | undefined;
    if (report?.header?.glibcVersionRuntime) return false;
    if (Array.isArray(report?.sharedObjects)) {
      return report.sharedObjects.some(
        (lib) => lib.includes("ld-musl-") || lib.includes("libc.musl-"),
      );
    }
  } catch {
    return false;
  }
  return false;
}

export function isNativePlatformSupported(): boolean {
  if (isRunningInWebContainer()) return false;

  const platformKey = `${process.platform}-${process.arch}`;
  const expectedBinding =
    process.platform === "linux" ? `${platformKey}-${isMuslLinux() ? "musl" : "gnu"}` : platformKey;
  return getNativeBindingNames().some((binding) => binding === expectedBinding);
}
