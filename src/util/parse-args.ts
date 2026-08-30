import { parseArgs as nodeParseArgs } from "node:util";

type ParsedValue = unknown;

const isHex = /^0x[0-9a-f]+$/i;
const isDecimal = /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(e[-+]?\d+)?$/i;
const coerce = (value: string): string | number =>
  isHex.test(value) || isDecimal.test(value) ? Number(value) : value;

export interface ParsedArgs {
  _: Array<string | number>;
  "--"?: string[];
  [key: string]: unknown;
}

interface Opts {
  string?: string[];
  boolean?: string[];
  alias?: Record<string, string | string[]>;
  "--"?: boolean;
}

const setNested = (target: ParsedArgs, key: string, value: unknown) => {
  if (!key.includes(".")) {
    target[key] = value;
    return;
  }
  const parts = key.split(".");
  let object: Record<string, unknown> = target;
  for (let index = 0; index < parts.length - 1; index++) {
    const part = parts[index] ?? "";
    if (typeof object[part] !== "object" || object[part] === null) object[part] = {};
    object = object[part] as Record<string, unknown>;
  }
  object[parts.at(-1) ?? ""] = value;
};

const parseArgs = (
  input: readonly (string | { value?: string })[],
  opts: Opts = {},
): ParsedArgs => {
  const argv = input.flatMap((arg) =>
    typeof arg === "string" ? [arg] : arg?.value ? [arg.value] : [],
  );
  const strings = new Set(opts.string ?? []);
  const booleans = new Set(opts.boolean ?? []);
  const groups = new Map<string, string[]>();
  const canonicalOf = new Map<string, string>();
  for (const key of Object.keys(opts.alias ?? {})) {
    const names = [key, ...([opts.alias?.[key]].flat() as string[])];
    const isString = names.some((name) => strings.has(name));
    const isBoolean = names.some((name) => booleans.has(name));
    groups.set(key, names);
    for (const name of names) {
      canonicalOf.set(name, key);
      if (isString) strings.add(name);
      if (isBoolean) booleans.add(name);
    }
  }
  const canonical = (name: string) => canonicalOf.get(name) ?? name;
  const args = argv.map((arg) => (/^-[A-Za-z]=/.test(arg) ? `-${arg}` : arg));
  let tokens: ReturnType<typeof nodeParseArgs>["tokens"] = [];
  try {
    ({ tokens } = nodeParseArgs({ args, strict: false, allowPositionals: true, tokens: true }));
  } catch {
    return { _: [] };
  }
  const positionals: Array<string | number> = [];
  const doubleDash: string[] = [];
  const store = new Map<string, unknown>();
  const consumed = new Set<number>();
  let terminated = false;
  const set = (name: string, value: unknown) => {
    const key = canonical(name);
    const previous = store.get(key);
    if (previous === undefined) store.set(key, value);
    else if (previous === true && value === true) return;
    else if (Array.isArray(previous)) previous.push(value);
    else store.set(key, [previous, value]);
  };
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (!token) continue;
    if (token.kind === "option-terminator") terminated = true;
    else if (token.kind === "positional") {
      if (terminated && opts["--"]) doubleDash.push(token.value);
      else if (!consumed.has(index)) positionals.push(coerce(token.value));
    } else if (token.value === undefined && token.rawName.startsWith("--no-"))
      set(token.name.slice(3), false);
    else {
      const name = token.name;
      if (booleans.has(name)) set(name, token.value !== "false");
      else if (token.value !== undefined)
        set(name, strings.has(name) ? token.value : coerce(token.value));
      else {
        const next = tokens[index + 1];
        if (next?.kind === "positional" && !consumed.has(index + 1)) {
          consumed.add(index + 1);
          set(name, strings.has(name) ? next.value : coerce(next.value));
        } else set(name, strings.has(name) ? "" : true);
      }
    }
  }
  for (const name of booleans) if (!store.has(canonical(name))) store.set(canonical(name), false);
  const result: ParsedArgs = { _: positionals };
  for (const [key, value] of store)
    for (const name of groups.get(key) ?? [key]) setNested(result, name, value);
  if (opts["--"]) result["--"] = doubleDash;
  return result;
};

export default parseArgs;
