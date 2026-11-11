import { describe, expect, it } from "vitest";
import {
  parsePluginJson,
  parsePluginYaml,
  hasCommand,
  staticPropertyName,
  packageRoot,
} from "../../src/plugin-utils.js";

describe("plugin reliability helpers", () => {
  it("parses JSONC without deleting URL-like string content and accepts a BOM", () => {
    const value = parsePluginJson<{ url: string; enabled: boolean }>(
      '\ufeff{\n  // keep this comment\n  "url": "https://example.test/a//b",\n  "enabled": true,\n}',
    );
    expect(value).toEqual({ url: "https://example.test/a//b", enabled: true });
  });

  it("rejects malformed JSONC instead of returning a misleading partial object", () => {
    expect(parsePluginJson('{ "url": "unterminated }')).toBeNull();
  });

  it("parses YAML values used by tool configuration plugins", () => {
    expect(parsePluginYaml<{ plugins: string[] }>("plugins:\n  - postcss-nested\n")).toEqual({
      plugins: ["postcss-nested"],
    });
  });

  it("matches commands at shell token boundaries, not comments or substrings", () => {
    expect(hasCommand("echo parcelship", ["parcel"])).toBe(false);
    expect(hasCommand("# parcel build", ["parcel"])).toBe(false);
    expect(hasCommand("pnpm exec semantic-release", ["semantic-release"])).toBe(true);
  });

  it("normalizes quoted AST keys and scoped package subpaths", () => {
    expect(staticPropertyName({ type: "Literal", value: "plugins" })).toBe("plugins");
    expect(packageRoot("@semantic-release/git/lib/verify.js")).toBe("@semantic-release/git");
  });
});
