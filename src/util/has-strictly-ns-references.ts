export function hasStrictlyNsReferences(
  _moduleGraph: Map<string, unknown>,
  _filePath: string,
  imports: { refs: Set<string>; importNs: Map<string, Set<string>> },
  _id: string,
): [boolean, string?] {
  const namespaces = [...imports.importNs.keys()];
  if (namespaces.length === 0) return [false];
  if (namespaces.length > 1) {
    const unused = namespaces.find((namespace) => !imports.refs.has(namespace));
    if (unused) return [false, unused];
  }
  for (const namespace of namespaces) {
    const direct = imports.refs.has(namespace);
    const member = [...imports.refs].some((ref) => ref.startsWith(`${namespace}.`));
    if (!direct) return [false, namespace];
    if (!member && namespaces.length === 1) return [true, namespace];
    if (member) return [false, namespace];
  }
  return [false];
}
