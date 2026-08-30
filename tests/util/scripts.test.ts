import assert from "node:assert/strict";
import { describe, test } from "vitest";
import { getScriptCommands, toShellCommand } from "../../src/util/scripts.js";

describe("script utilities", () => {
  test("splits chained commands", () => {
    assert.deepEqual(getScriptCommands("bun run build && bun test"), [
      { binary: "bun", args: ["run", "build"] },
      { binary: "bun", args: ["test"] },
    ]);
  });

  test("keeps options with their command", () => {
    assert.deepEqual(getScriptCommands("bun --config=x test ./a"), [
      { binary: "bun", args: ["--config=x", "test", "./a"] },
    ]);
  });

  test("unwraps spawning binaries", () => {
    assert.deepEqual(getScriptCommands("cross-env NODE_ENV=test bun test"), [
      { binary: "bun", args: ["test"] },
    ]);
    assert.deepEqual(getScriptCommands("retry-cli -- node --test"), [
      { binary: "node", args: ["--test"] },
    ]);
    assert.deepEqual(getScriptCommands("c8 node --test"), [{ binary: "node", args: ["--test"] }]);
  });

  test("keeps quoted arguments intact", () => {
    assert.deepEqual(getScriptCommands('cross-env FLAGS="-a;-b" bun test --filter="unit;fast"'), [
      { binary: "bun", args: ["test", "--filter=unit;fast"] },
    ]);
  });

  test("normalizes binary paths", () => {
    assert.deepEqual(getScriptCommands("./node_modules/.bin/bun test"), [
      { binary: "bun", args: ["test"] },
    ]);
  });

  test("returns an empty array for empty or unparseable scripts", () => {
    assert.deepEqual(getScriptCommands(""), []);
    assert.deepEqual(getScriptCommands("'unterminated"), []);
  });

  test("round-trips argv through the script parser", () => {
    const roundTrip = (argv: string[]) =>
      assert.deepEqual(getScriptCommands(toShellCommand(argv)), [
        { binary: argv[0], args: argv.slice(1) },
      ]);
    roundTrip(["node", "lib/server.js"]);
    roundTrip(["node", "--title=mdx content mapper", "lib/server.js"]);
    roundTrip(["node", "lib/server.js; rm -rf tmp"]);
    roundTrip(["node", "$HOME/server.js"]);
    roundTrip(["node", "it's/server.js"]);
    roundTrip(["node", "lib/*.js"]);
  });
});
