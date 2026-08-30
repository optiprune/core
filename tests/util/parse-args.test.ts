import assert from "node:assert/strict";
import { describe, test } from "vitest";
import parseArgs from "../../src/util/parse-args.js";

describe("parseArgs", () => {
  test("parses positionals", () => {
    assert.deepEqual(parseArgs(["a", "b"]), { _: ["a", "b"] });
    assert.deepEqual(parseArgs([]), { _: [] });
    assert.deepEqual(parseArgs(["a", "--flag", "b"])._, ["a"]);
  });

  test("greedily consumes values for undeclared options", () => {
    assert.deepEqual(parseArgs(["--package", "@scope/pkg", "cmd"]), {
      _: ["cmd"],
      package: "@scope/pkg",
    });
    assert.deepEqual(parseArgs(["-p", "pkg"], { alias: { package: "p" } }), {
      _: [],
      p: "pkg",
      package: "pkg",
    });
    assert.equal(parseArgs(["--require", "pkg", "script.js"]).require, "pkg");
  });

  test("parses short flag bundles and inline values", () => {
    assert.deepEqual(parseArgs(["-abc"]), { _: [], a: true, b: true, c: true });
    assert.deepEqual(parseArgs(["-pfoo"]), { _: [], p: true, f: true, o: true });
    assert.deepEqual(parseArgs(["-p=plugin"], { alias: { plugin: "p" } }), {
      _: [],
      p: "plugin",
      plugin: "plugin",
    });
  });

  test("handles declared strings and booleans", () => {
    assert.deepEqual(parseArgs(["--cwd"], { string: ["cwd"] }), { _: [], cwd: "" });
    assert.deepEqual(parseArgs(["--quiet"], { boolean: ["quiet"] }), { _: [], quiet: true });
    assert.deepEqual(parseArgs([], { boolean: ["quiet"] }), { _: [], quiet: false });
    assert.deepEqual(parseArgs(["--quiet", "x"], { boolean: ["quiet"] }), {
      _: ["x"],
      quiet: true,
    });
    assert.deepEqual(parseArgs(["--quiet=false"], { boolean: ["quiet"] }), { _: [], quiet: false });
  });

  test("accumulates repeated options and mirrors aliases", () => {
    assert.deepEqual(parseArgs(["--foo", "a", "--foo", "b"], { string: ["foo"] }), {
      _: [],
      foo: ["a", "b"],
    });
    const parsed = parseArgs(["--require=a", "--require", "b", "script"], {
      string: ["r"],
      alias: { require: ["r", "loader", "import"] },
    });
    assert.deepEqual(parsed._, ["script"]);
    for (const key of ["require", "r", "loader", "import"])
      assert.deepEqual(parsed[key], ["a", "b"]);
  });

  test("supports dotted options", () => {
    assert.deepEqual(parseArgs(["--coverage.provider=v8"]), {
      _: [],
      coverage: { provider: "v8" },
    });
    assert.deepEqual(parseArgs(["--typecheck.checker", "tsc"]), {
      _: [],
      typecheck: { checker: "tsc" },
    });
    assert.deepEqual(parseArgs(["--a.b=1", "--a.c=2"]).a, { b: 1, c: 2 });
  });

  test("captures arguments after double dash when configured", () => {
    assert.deepEqual(parseArgs(["run", "build", "--", "node", "x.js"], { "--": true }), {
      _: ["run", "build"],
      "--": ["node", "x.js"],
    });
    assert.deepEqual(parseArgs(["run", "--"], { "--": true }), { _: ["run"], "--": [] });
    assert.deepEqual(parseArgs(["--no", "--", "pkg", "--edit"], { boolean: ["no"] }), {
      _: ["pkg", "--edit"],
      no: true,
    });
  });

  test("coerces numeric positionals and values", () => {
    assert.deepEqual(parseArgs(["8080", "foo"]), { _: [8080, "foo"] });
    assert.deepEqual(parseArgs(["0x10", "1e3", "007", ".5"]), { _: [16, 1000, 7, 0.5] });
    assert.deepEqual(parseArgs(["--port", "8080"]), { _: [], port: 8080 });
    assert.deepEqual(parseArgs(["--port", "8080"], { string: ["port"] }), { _: [], port: "8080" });
    assert.deepEqual(parseArgs(["--", "8080"], { "--": true }), { _: [], "--": ["8080"] });
  });

  test("handles negated flags, non-string args, and immutability", () => {
    assert.deepEqual(parseArgs(["--no-install"]), { _: [], install: false });
    assert.deepEqual(parseArgs(["--no-foo", "8080"]), { _: [8080], foo: false });
    assert.deepEqual(
      parseArgs(["-c", undefined as unknown as string], {
        string: ["config"],
        alias: { config: "c" },
      }),
      {
        _: [],
        c: "",
        config: "",
      },
    );
    const argv = ["-y", "pkg"];
    const opts = { boolean: ["yes"], alias: { yes: "y" } };
    parseArgs(argv, opts);
    assert.deepEqual(argv, ["-y", "pkg"]);
    assert.deepEqual(opts, { boolean: ["yes"], alias: { yes: "y" } });
  });
});
