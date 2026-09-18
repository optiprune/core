export function connect(port = 8080, protocol = 'https') {
  return `${protocol}:${port}`;
}

export function configure(options) {
  const { timeout = 5000, retries = 3 } = options;
  return timeout + retries;
}

export function inspectList(list) {
  const { head, ...unusedTail } = list;
  return head;
}

export function unusedDefault(value = 'never initialized') {
  return value;
}
