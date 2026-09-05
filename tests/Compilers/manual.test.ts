import { describe, expect, it } from "vitest";
import { mergeConfig, DEFAULT_CONFIG } from "../../src/config-loader.js";
describe("manual compilers", () =>
  it("accepts configured compilers", () =>
    expect(
      mergeConfig(DEFAULT_CONFIG, { compilers: { ".mdx": { dependencies: ["@mdx-js/mdx"] } } })
        .compilers[".mdx"],
    ).toBeTruthy()));
