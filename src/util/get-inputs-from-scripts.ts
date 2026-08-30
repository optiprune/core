import { getScriptCommands, type ScriptCommand } from "./scripts.js";

export interface ScriptInput extends ScriptCommand {
  kind: "binary" | "entry";
}

export function getInputsFromScripts(scripts: readonly string[]): ScriptInput[] {
  const inputs: ScriptInput[] = [];
  for (const script of scripts) {
    for (const command of getScriptCommands(script)) {
      const first = command.args.find((arg) => !arg.startsWith("-"));
      const kind =
        first && (/^\.?\.?\//.test(first) || /\.(?:[cm]?tsx?|jsx?)$/.test(first))
          ? "entry"
          : "binary";
      inputs.push({ ...command, kind });
    }
  }
  return inputs;
}
