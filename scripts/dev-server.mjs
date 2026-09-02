import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
const root = resolve(new URL("../docs/dist/", import.meta.url).pathname);
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".txt": "text/plain",
};
const server = createServer(async (req, res) => {
  try {
    let path = decodeURIComponent((req.url || "/").split("?")[0]);
    if (path === "/") path = "/index.html";
    const file = join(root, path);
    try {
      await stat(file);
      res.setHeader("Content-Type", mime[extname(file)] || "application/octet-stream");
      res.end(await readFile(file));
    } catch {
      res.setHeader("Content-Type", "text/html");
      res.end(await readFile(join(root, "index.html")));
    }
  } catch (e) {
    res.statusCode = 500;
    res.end(String(e));
  }
});
server.listen(process.env.PORT || 8788, () =>
  console.log(`OptiPrune docs at http://localhost:${process.env.PORT || 8788}`),
);
