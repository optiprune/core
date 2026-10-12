import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isNativePlatformSupported,
  isRunningInWebContainer,
  nativeBindingName,
} from "../src/platform.js";

describe("Yuku platform selection", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    ["linux", "x64", false, "linux-x64-gnu"],
    ["linux", "x64", true, "linux-x64-musl"],
    ["linux", "arm64", false, "linux-arm64-gnu"],
    ["darwin", "arm64", false, "darwin-arm64"],
    ["win32", "x64", false, "win32-x64"],
  ] as const)("maps %s/%s to %s", (platform, arch, musl, expected) => {
    expect(nativeBindingName(platform, arch, musl)).toBe(expected);
  });

  it("forces the portable backend in StackBlitz/WebContainers", () => {
    vi.stubEnv("STACKBLITZ", "1");
    expect(isRunningInWebContainer()).toBe(true);
    expect(isNativePlatformSupported()).toBe(false);
  });

  it("uses the parser backend selected during module initialization", async () => {
    const { getParserBackend, parseWithYukuBackend } = await import("../src/parser.js");
    expect(["node", "wasm"]).toContain(getParserBackend());
    expect(
      parseWithYukuBackend("export const answer: number = 42", {
        lang: "ts",
        sourceType: "module",
      }).program.type,
    ).toBe("Program");
  });
});
