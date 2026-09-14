import { bump } from "bumpp";

export async function release() {
  return bump({ files: ["package.json"] });
}
