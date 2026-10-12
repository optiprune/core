import { build } from "esbuild";
import { chromium } from "@playwright/test";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const testDir = join(root, "webcontainer-tests");
const fixtureDir = join(testDir, "fixture");
const bundlePath = join(testDir, "client.bundle.js");

rmSync(fixtureDir, { recursive: true, force: true });
mkdirSync(fixtureDir, { recursive: true });
const coreDir = join(root, "core");
const toFileTree = (directory) => ({
  directory: Object.fromEntries(
    readdirSync(directory, { withFileTypes: true }).map((entry) => [
      entry.name,
      entry.isDirectory()
        ? toFileTree(join(directory, entry.name))
        : { file: { contents: readFileSync(join(directory, entry.name), "utf8") } },
    ]),
  ),
});
writeFileSync(
  join(fixtureDir, "core-tree.json"),
  JSON.stringify({
    directory: {
      "package.json": { file: { contents: readFileSync(join(coreDir, "package.json"), "utf8") } },
      dist: toFileTree(join(coreDir, "dist")),
    },
  }),
);

await build({
  entryPoints: [join(testDir, "client.js")],
  bundle: true,
  format: "esm",
  platform: "browser",
  outfile: bundlePath,
});

const server = createServer((request, response) => {
  const requested = request.url === "/" ? "/webcontainer-tests/index.html" : request.url;
  const requestPath = requested.split("?")[0];
  const filePath = normalize(
    requestPath.startsWith("/fixture/")
      ? join(testDir, requestPath.slice(1))
      : join(root, requestPath),
  );
  if (!filePath.startsWith(root) || !existsSync(filePath)) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }
  const types = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".tgz": "application/gzip",
  };
  response.writeHead(200, {
    "Content-Type": types[extname(filePath)] ?? "application/octet-stream",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Embedder-Policy": "require-corp",
    "Cross-Origin-Resource-Policy": "same-origin",
  });
  response.end(readFileSync(filePath));
});

await new Promise((resolveServer) => server.listen(0, "127.0.0.1", resolveServer));
const { port } = server.address();
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage();
page.on("console", (message) => console.log(`[browser:${message.type()}] ${message.text()}`));
page.on("pageerror", (error) => console.error(`[browser:error] ${error.stack}`));

try {
  await page.goto(`http://127.0.0.1:${port}/webcontainer-tests/index.html`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForFunction(() => window.__webcontainerTestResult !== undefined, null, {
    timeout: 180_000,
  });
  const result = await page.evaluate(() => window.__webcontainerTestResult);
  if (!result?.ok) throw new Error(result?.error ?? "WebContainer integration test failed");
  console.log(result.output);
} finally {
  await browser.close();
  server.close();
  rmSync(bundlePath, { force: true });
  rmSync(fixtureDir, { recursive: true, force: true });
}
