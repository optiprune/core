export function forInWritesFlag(keys: Record<string, unknown>) {
  let found = false;
  for (const key in keys) {
    if (key) found = true;
  }
  if (found && keys.missing) {
    console.log("possibly reachable");
  }
}
