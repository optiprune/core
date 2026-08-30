import { readFileSync } from "node:fs";
import { toPosix } from "./path.js";

export const isStartsLikePackageName = (specifier: string) => {
  const first = specifier.charCodeAt(0);
  const valid = (code: number) =>
    (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
  const scoped = (code: number) => valid(code) || code === 46 || code === 95 || code === 126;
  return first === 64 ? scoped(specifier.charCodeAt(1)) : valid(first);
};

export const getPackageNameFromModuleSpecifier = (specifier: string) => {
  if (!isStartsLikePackageName(specifier)) return undefined;
  if (specifier.startsWith("@")) {
    const slash = specifier.indexOf("/", 1);
    if (slash < 0) return specifier;
    const next = specifier.indexOf("/", slash + 1);
    return next < 0 ? specifier : specifier.slice(0, next);
  }
  const slash = specifier.indexOf("/");
  return slash < 0 ? specifier : specifier.slice(0, slash);
};

export const getPackageNameFromFilePath = (value: string) => {
  const path = toPosix(value.replace(/^file:\/\//, ""));
  const matches = [...path.matchAll(/(?:^|\/node_modules\/)(@[^/]+\/[^/]+|[^/]+)/g)];
  const name = matches.at(-1)?.[1];
  if (name && name !== ".store") return name;
  const store = path.match(/\/node_modules\/\.store\/[^/]+\/package(?:\/|$)/);
  if (store) {
    try {
      const packageJson = JSON.parse(readFileSync(`${store[0].slice(0, -1)}/package.json`, "utf8"));
      if (packageJson.name) return packageJson.name;
    } catch {}
  }
  return name ?? value;
};

export const getPackageNameFromSpecifier = (specifier: string) =>
  specifier.includes("node_modules")
    ? getPackageNameFromFilePath(specifier)
    : getPackageNameFromModuleSpecifier(specifier);

export const getDefinitelyTypedFor = (packageName: string) => {
  if (packageName.startsWith("@types/")) return packageName;
  return packageName.startsWith("@")
    ? `@types/${packageName.slice(1).replace("/", "__")}`
    : `@types/${packageName}`;
};

export const getPackageFromDefinitelyTyped = (typedDependency: string) =>
  typedDependency.includes("__")
    ? `@${typedDependency.replace(/^@types\//, "").replace("__", "/")}`
    : typedDependency;

export const extractBinary = (command: string) =>
  command
    .replace(/^(?:\.\.\/|\.\/)*node_modules\/(?:\.bin\/)?/, "")
    .replace(/@[^/]+$/, "")
    .replace(/@[^/]+$/, "");
export const isValidBinary = (value: string) => !/[*:!()]/.test(value);
export const isDefinitelyTyped = (packageName: string) => packageName.startsWith("@types/");

export const sanitizeSpecifier = (specifier: string) => {
  if (
    specifier.startsWith("node:") ||
    specifier.startsWith("virtual:") ||
    specifier.startsWith("#") ||
    specifier.startsWith(":") ||
    specifier.startsWith("~/") ||
    specifier.startsWith("/")
  )
    return specifier;
  let value = specifier.replace(/^[-!]+/, "");
  const bang = value.indexOf("!");
  if (bang >= 0) value = value.slice(0, bang);
  const query = value.search(/[?#]/);
  if (query >= 0) value = value.slice(0, query);
  const colon = value.indexOf(":");
  if (colon >= 0 && !value.slice(0, colon).includes("/")) value = value.slice(0, colon);
  return value;
};
