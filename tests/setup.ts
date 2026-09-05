/**
 * Keep the test command readable without changing library or CLI output.
 *
 * Set OPTIPRUNE_TEST_QUIET=0 to inspect console output while debugging a test.
 * Vitest's own reporter output and assertion failures are unaffected.
 */
if (process.env.OPTIPRUNE_TEST_QUIET !== "0") {
  for (const method of ["debug", "info", "log", "warn", "error"] as const) {
    Object.defineProperty(console, method, {
      configurable: true,
      value: () => undefined,
    });
  }
}
