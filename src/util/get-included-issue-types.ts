export const ISSUE_TYPES = [
  "dependencies",
  "devDependencies",
  "optionalPeerDependencies",
  "unlisted",
  "binaries",
  "unresolved",
  "catalog",
  "catalogReferences",
  "exports",
  "types",
  "enumMembers",
  "namespaceMembers",
  "duplicates",
  "files",
  "cycles",
  "nsExports",
  "nsTypes",
] as const;

export const defaultExcludedIssueTypes = ["nsExports", "nsTypes", "cycles"] as const;
const defaultAddOnIssueTypes = ["nsExports", "nsTypes"];
const defaultIssueTypes = ISSUE_TYPES.filter(
  (type) => !(defaultExcludedIssueTypes as readonly string[]).includes(type),
);
const normalize = (values: string[]) => values.flatMap((value) => value.split(","));
export const shorthandDeps = [
  "dependencies",
  "unlisted",
  "binaries",
  "unresolved",
  "catalog",
  "catalogReferences",
];
export const shorthandExports = [
  "exports",
  "types",
  "enumMembers",
  "namespaceMembers",
  "duplicates",
];
export const shorthandFiles = ["files"];
export const shorthandCycles = ["cycles"];

export interface IssueTypeOptions {
  isProduction?: boolean;
  include: string[];
  exclude: string[];
  includeOverrides?: string[];
  excludeOverrides?: string[];
}

export const getIncludedIssueTypes = (options: IssueTypeOptions) => {
  const includeOverrides = normalize(options.includeOverrides ?? []);
  const excludeOverrides = normalize(options.excludeOverrides ?? []);
  const allRequested = [
    ...includeOverrides,
    ...excludeOverrides,
    ...options.include,
    ...options.exclude,
  ];
  for (const type of allRequested)
    if (!(ISSUE_TYPES as readonly string[]).includes(type))
      throw new Error(`Invalid issue type: ${type}`);
  const excludes = options.exclude.filter((type) => !includeOverrides.includes(type));
  const includes = options.include.filter((type) => !excludeOverrides.includes(type));
  const include = [...includeOverrides, ...includes];
  const exclude = [...excludeOverrides, ...excludes];
  if (options.isProduction) {
    exclude.push("devDependencies", "catalog", "catalogReferences");
  } else if (include.includes("dependencies")) {
    include.push("devDependencies", "optionalPeerDependencies");
  } else if (exclude.includes("dependencies")) {
    exclude.push("devDependencies", "optionalPeerDependencies");
  }
  const selected = (
    include.length > 0
      ? include.some((type) => !(defaultAddOnIssueTypes as readonly string[]).includes(type))
        ? include
        : [...include, ...defaultIssueTypes]
      : defaultIssueTypes
  ).filter((type) => !exclude.includes(type));
  return Object.fromEntries(ISSUE_TYPES.map((type) => [type, selected.includes(type)]));
};
