export interface ScriptCommand {
  binary: string;
  args: string[];
}

const spawningBinaries = new Set(["c8", "cross-env", "retry-cli"]);

export const toShellCommand = (argv: string[]): string =>
  argv.map((arg) => `'${arg.replaceAll("'", `'\\''`)}'`).join(" ");

function tokenize(script: string): string[][] {
  const commands: string[][] = [];
  let command: string[] = [];
  let token = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;
  const flush = () => {
    if (token) command.push(token);
    token = "";
  };
  const end = () => {
    flush();
    if (command.length) commands.push(command);
    command = [];
  };
  for (const char of script) {
    if (escaped) {
      token += char;
      escaped = false;
    } else if (char === "\\" && quote !== "'") escaped = true;
    else if (quote) {
      if (char === quote) quote = null;
      else token += char;
    } else if (char === "'" || char === '"') quote = char;
    else if (/\s/.test(char)) flush();
    else if (char === ";" || char === "&" || char === "|") end();
    else token += char;
  }
  if (quote || escaped) return [];
  end();
  return commands;
}

function binaryName(value: string): string {
  return value.replaceAll("\\", "/").split("/").at(-1) ?? value;
}

function unwrap(command: string[]): ScriptCommand[] {
  if (!command.length) return [];
  const rawBinary = command[0] ?? "";
  const binary = binaryName(rawBinary);
  if (spawningBinaries.has(binary)) {
    const separator = command.indexOf("--");
    const rest =
      separator >= 0
        ? command.slice(separator + 1)
        : command.slice(1).filter((arg) => !/^\w+=/.test(arg));
    return getScriptCommands(rest.map((arg) => `'${arg.replaceAll("'", `'\\''`)}'`).join(" "));
  }
  return [{ binary, args: command.slice(1) }];
}

export const getScriptCommands = (script: string): ScriptCommand[] => {
  if (!script) return [];
  return tokenize(script).flatMap(unwrap);
};
