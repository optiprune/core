#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import process from "node:process";

const version = process.argv[2];
const repository = process.env.GITHUB_REPOSITORY ?? "optiprune/core";
const marker = `<!-- optiprune-release:${version} -->`;

if (!version) {
  throw new Error(
    "A release version is required, for example: node scripts/comment-release-items.mjs 1.17.0",
  );
}

function ghApi(path, options = {}) {
  const args = ["api", path];
  if (options.method) args.push("--method", options.method);
  if (options.fields) {
    for (const [key, value] of Object.entries(options.fields)) {
      args.push("-f", `${key}=${value}`);
    }
  }
  const output = execFileSync("gh", args, { encoding: "utf8" }).trim();
  return output ? JSON.parse(output) : null;
}

function ghJson(path) {
  const output = execFileSync("gh", ["api", path, "--paginate", "--slurp"], {
    encoding: "utf8",
  }).trim();
  if (!output) return [];
  const pages = JSON.parse(output);
  return pages.flat();
}

function commentOnce(issueNumber, body) {
  const comments = ghJson(`repos/${repository}/issues/${issueNumber}/comments`);
  if (comments.some((comment) => comment.body?.includes(marker))) return false;
  ghApi(`repos/${repository}/issues/${issueNumber}/comments`, {
    method: "POST",
    fields: { body },
  });
  return true;
}

let previousReleaseDate = "1970-01-01T00:00:00Z";
try {
  const previousTag = execFileSync("git", ["describe", "--tags", "--abbrev=0", "HEAD^"], {
    encoding: "utf8",
  }).trim();
  previousReleaseDate = execFileSync("git", ["show", "-s", "--format=%cI", previousTag], {
    encoding: "utf8",
  }).trim();
} catch {
  // The first release has no previous tag; include all merged PRs.
}

const prs = ghJson(
  `repos/${repository}/pulls?state=closed&base=main&sort=updated&direction=desc&per_page=100`,
).filter((pr) => pr.merged_at && pr.merged_at > previousReleaseDate);
const issueLinks = new Map();

for (const pr of prs) {
  const text = `${pr.title}\n${pr.body ?? ""}`;
  const matches = [...text.matchAll(/\b(?:fix(?:e[sd])?|close[sd]?|resolve[sd]?)\s+#(\d+)/gi)];
  for (const match of matches) {
    if (!issueLinks.has(match[1])) issueLinks.set(match[1], []);
    issueLinks.get(match[1]).push(pr);
  }

  const body = `${marker}\nIncluded in **@optiprune/core@${version}**.\n\nThis pull request was merged and included in release [v${version}](https://github.com/${repository}/releases/tag/v${version}).`;
  if (commentOnce(pr.number, body)) console.log(`Commented on PR #${pr.number}`);
}

for (const [issueNumber, linkedPrs] of issueLinks) {
  const references = linkedPrs
    .map((pr) => `[#${pr.number}](https://github.com/${repository}/pull/${pr.number})`)
    .join(", ");
  const body = `${marker}\nPatched in **@optiprune/core@${version}**.\n\nThe fix was delivered by ${references} and is included in [release v${version}](https://github.com/${repository}/releases/tag/v${version}).`;
  if (commentOnce(issueNumber, body)) console.log(`Commented on issue #${issueNumber}`);
}
