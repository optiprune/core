import fs from "node:fs";
const report = JSON.parse(fs.readFileSync("/tmp/knip-parity-report.json", "utf8"));
const rows = [];
for (const file of report.testResults ?? []) {
  for (const assertion of file.assertionResults ?? []) {
    if (assertion.status !== "failed") continue;
    const fixture = assertion.fullName.match(/expectations for (.+)$/)?.[1] ?? assertion.fullName;
    const message = assertion.failureMessages?.[0] ?? "";
    const expected = message.match(/expected (?:true|false) to be true/);
    const detail = message.match(/expected (\w+) ([^ ]+) ([^:]+):/);
    rows.push({
      fixture,
      kind: detail?.[1] ?? "unknown",
      file: detail?.[2] ?? "",
      value: detail?.[3] ?? "",
      message: message.split("\n")[0],
    });
  }
}
fs.writeFileSync(
  "/tmp/knip-parity-failures.tsv",
  rows.map((row) => Object.values(row).join("\t")).join("\n") + "\n",
);
console.log(`wrote ${rows.length} failures`);
