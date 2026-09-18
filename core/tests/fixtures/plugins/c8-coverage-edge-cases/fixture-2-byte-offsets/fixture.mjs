export function evaluate(a, b, c) {
  const nested = a ? (b ? (c ? 'all-true' : 'c-false') : (c ? 'b-false-c-true' : 'all-false')) : 'a-false';
  const chain = a && b || c;
  const invoked = [1, 2, 3].map(x => x * 2).filter(x => x > 0).reduce((sum, x) => sum + x, 0);
  const never = [1, 2].map(x => x).find(x => x < 0);
  const summary = nested + ':' + chain + ':' + invoked;
  return summary; const deadAfterReturn = never;
}

export const squeezed = () => { const first = 'first'; const second = 'second'; return first + second; };
