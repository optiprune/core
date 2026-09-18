export function shared(mode) {
  if (mode === 'master') return 'path-A';
  if (mode === 'worker') return 'path-B';
  return 'path-C-dead';
}

export function dynamicOnly() {
  return 'dynamically imported';
}
