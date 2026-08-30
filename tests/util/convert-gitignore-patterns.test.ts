import assert from "node:assert/strict";
import { EOL } from "node:os";
import { describe, test } from "vitest";
import {
  convertGitignoreToPicomatchIgnorePatterns as convert,
  parseAndConvertGitignorePatterns as parse,
  toExtendedIgnorePattern as ext,
} from "../../src/util/parse-and-convert-gitignores.js";

describe("gitignore pattern utilities", () => {
  test("converts gitignore patterns to picomatch patterns", () => {
    assert.deepEqual(convert("*.ext"), { negated: false, pattern: "**/*.ext" });
    assert.deepEqual(convert("!*.ext"), { negated: true, pattern: "**/*.ext" });
    assert.deepEqual(convert("dir"), { negated: false, pattern: "**/dir" });
    assert.deepEqual(convert("dir/"), { negated: false, pattern: "**/dir" });
    assert.deepEqual(convert(".dot"), { negated: false, pattern: "**/.dot" });
    assert.deepEqual(convert("*.stars*"), { negated: false, pattern: "**/*.stars*" });
    assert.deepEqual(convert("!.ext"), { negated: true, pattern: "**/.ext" });
    assert.deepEqual(convert("file.ext"), { negated: false, pattern: "**/file.ext" });
    assert.deepEqual(convert("/root"), { negated: false, pattern: "root" });
    assert.deepEqual(convert("/**/.dot/*"), { negated: false, pattern: "**/.dot/*" });
    assert.deepEqual(convert("!/**/.dot/dir"), { negated: true, pattern: "**/.dot/dir" });
    assert.deepEqual(convert("!/no-root"), { negated: true, pattern: "no-root" });
    assert.deepEqual(convert("so/deep/dir"), { negated: false, pattern: "**/so/deep/dir" });
    assert.deepEqual(convert("/**/root-star"), { negated: false, pattern: "**/root-star" });
    assert.deepEqual(convert("!**/dir/**/f.ext"), { negated: true, pattern: "**/dir/**/f.ext" });
  });

  test("extends ignore patterns", () => {
    assert.equal(ext("*"), "*");
    assert.equal(ext("**"), "**");
    assert.equal(ext("**/.dot/*"), "**/.dot/*/**");
    assert.equal(ext("**/.dot/*", true), "**/.dot/*");
    assert.equal(ext("**/dir"), "**/dir/**");
    assert.equal(ext("root"), "root/**");
    assert.equal(ext("**/a/b/c"), "**/a/b/c/**");
  });

  test("parses and converts patterns", () => {
    assert.deepEqual(parse([".git", "node_modules", "a/b/c", "/a/b/c"].join(EOL)), [
      { negated: false, pattern: "**/.git" },
      { negated: false, pattern: "**/node_modules" },
      { negated: false, pattern: "**/a/b/c" },
      { negated: false, pattern: "a/b/c" },
    ]);
  });

  test("relativizes ancestor patterns", () => {
    assert.deepEqual(parse([".git", "node_modules", "a/b/c", "/a/b/c"].join(EOL), "a/b/"), [
      { negated: false, pattern: "**/.git" },
      { negated: false, pattern: "**/node_modules" },
      { negated: false, pattern: "**/c" },
      { negated: false, pattern: "c" },
    ]);
  });

  test("handles hashes and escaped comments", () => {
    assert.deepEqual(
      parse(["#comment", "ends-with-hash#", String.raw`\#starts-with-hash`].join(EOL)),
      [
        { negated: false, pattern: "**/ends-with-hash#" },
        { negated: false, pattern: "**/#starts-with-hash" },
      ],
    );
  });
});
