declare const adapter: {
  folderExists(path: string): Promise<boolean>;
};

export async function inspectPlugin(
  configFiles: string[],
  shouldScan: boolean,
  hasDependency: boolean,
) {
  let hasConfigFile = false;
  let remaining = shouldScan;

  // This mirrors the control flow used by project plugins: an async probe
  // mutates a flag and the loop guard is changed before the join.
  while (remaining) {
    if (await adapter.folderExists(configFiles[0] ?? "")) {
      hasConfigFile = true;
    }
    remaining = false;
  }

  if (hasConfigFile && !hasDependency) {
    console.log("emit plugin finding");
  }

  // This predicate is impossible after the loop: when the loop runs it sets
  // remaining to false, and when it does not run hasConfigFile stays false.
  if (hasConfigFile && remaining) {
    console.log("possibly reachable");
  }
}
