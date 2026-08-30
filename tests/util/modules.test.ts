import assert from "node:assert/strict";
import { describe, test } from "vitest";
import {
  getDefinitelyTypedFor,
  getPackageFromDefinitelyTyped,
  getPackageNameFromFilePath,
  getPackageNameFromModuleSpecifier,
  isStartsLikePackageName,
  sanitizeSpecifier,
} from "../../src/util/modules.js";

describe("modules utility", () => {
  test("maps DefinitelyTyped package names", () => {
    assert.equal(getDefinitelyTypedFor("node"), "@types/node");
    assert.equal(getDefinitelyTypedFor("@npmcli/map-workspaces"), "@types/npmcli__map-workspaces");
    assert.equal(getDefinitelyTypedFor("@types/node"), "@types/node");
    assert.equal(getPackageFromDefinitelyTyped("node"), "node");
    assert.equal(getPackageFromDefinitelyTyped("npmcli__map-workspaces"), "@npmcli/map-workspaces");
  });

  test("detects package-like specifiers and extracts names", () => {
    assert.equal(isStartsLikePackageName("react"), true);
    assert.equal(isStartsLikePackageName("@scope/pkg"), true);
    assert.equal(isStartsLikePackageName("./relative"), false);
    assert.equal(isStartsLikePackageName("#subpath"), false);
    assert.equal(getPackageNameFromModuleSpecifier("@scope/pkg/deep"), "@scope/pkg");
    assert.equal(getPackageNameFromModuleSpecifier("react/jsx-runtime"), "react");
    assert.equal(getPackageNameFromModuleSpecifier("./relative"), undefined);
  });

  test("extracts package names from node_modules paths", () => {
    assert.equal(getPackageNameFromFilePath("/root/node_modules/lodash/index.js"), "lodash");
    assert.equal(
      getPackageNameFromFilePath("/root/node_modules/@scope/pkg/index.js"),
      "@scope/pkg",
    );
    assert.equal(
      getPackageNameFromFilePath("/root/node_modules/@scope/pkg/node_modules/nested/index.js"),
      "nested",
    );
    assert.equal(getPackageNameFromFilePath("file:///root/node_modules/lodash/index.js"), "lodash");
  });

  test("sanitizes loader, query and protocol specifiers", () => {
    assert.equal(sanitizeSpecifier("specifier"), "specifier");
    assert.equal(sanitizeSpecifier("./icon.svg?raw"), "./icon.svg");
    assert.equal(sanitizeSpecifier("specifier#hash"), "specifier");
    assert.equal(sanitizeSpecifier("style-loader!css-loader?modules!./styles.css"), "style-loader");
    assert.equal(
      sanitizeSpecifier("!!style-loader!css-loader?modules!./styles.css"),
      "style-loader",
    );
    assert.equal(sanitizeSpecifier("astro:content"), "astro");
    assert.equal(sanitizeSpecifier("virtual:specifier"), "virtual:specifier");
    assert.equal(sanitizeSpecifier("node:fs"), "node:fs");
  });
});
