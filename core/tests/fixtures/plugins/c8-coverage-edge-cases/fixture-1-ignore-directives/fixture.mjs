export function parse(data) {
  /* c8 ignore next */
  if (!data) throw new Error('defensive guard');

  /* c8 ignore next 3 */
  if (data.fallback) {
    console.warn('fallback');
    return null;
  }

  /* c8 ignore start */
  if (process.env.DEBUG_FIXTURE) {
    console.debug('debug instrumentation');
  }
  const mockEnvironment = { now: Date.now() };
  void mockEnvironment;
  /* c8 ignore stop */

  if (data.unreachable) return 'adjacent-dead-code';
  return data.value;
}
