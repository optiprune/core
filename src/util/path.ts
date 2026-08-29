export {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  normalize,
  parse,
  relative,
  resolve,
  sep,
  toNamespacedPath,
} from "pathe";

export function toPosix(value: string): string {
  return value.replaceAll("\\", "/");
}
