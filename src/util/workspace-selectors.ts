import picomatch from "picomatch";

export type WorkspaceSelector = {
  type: "dir-glob" | "pkg-name";
  pattern: string;
  isNegated: boolean;
  cwd: string;
};

export const parseWorkspaceSelector = (selector: string, cwd: string): WorkspaceSelector => {
  const isNegated = selector.startsWith("!");
  const pattern = selector.replace(/^!/, "").replace(/^\.\//, "");
  const type =
    pattern.startsWith("@") || (!pattern.includes("/") && !pattern.includes("*"))
      ? "pkg-name"
      : "dir-glob";
  return { type, pattern, isNegated, cwd };
};

export const matchWorkspacesByPkgName = (
  pattern: string,
  pkgNames: string[],
  pkgNameToWorkspaceName: Map<string, string>,
) => {
  const matcher = picomatch(pattern);
  return pkgNames
    .filter((pkgName) => matcher(pkgName))
    .map((pkgName) => pkgNameToWorkspaceName.get(pkgName))
    .filter((name): name is string => !!name);
};

export const matchWorkspacesByDirGlob = (pattern: string, workspaceNames: string[]) => {
  const matcher = picomatch(pattern);
  return workspaceNames.filter((workspaceName) => matcher(workspaceName));
};
