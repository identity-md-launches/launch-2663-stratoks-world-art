// Preview the committed export under a subpath, without dependencies.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = fileURLToPath(new URL("../../dist/", import.meta.url));
const port = Number(process.argv[2] ?? 4173);
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/") {
    res.writeHead(302, { Location: "/preview/" });
    res.end();
    return;
  }
  const filename = path.resolve(
    root,
    decodeURIComponent(url.pathname.replace(/^\/preview\//, "")) ||
      "index.html",
  );
  if (!url.pathname.startsWith("/preview/") || !filename.startsWith(root)) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  try {
    const data = await readFile(filename);
    res.writeHead(200, {
      "Content-Type":
        types[path.extname(filename)] ?? "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
});
server.listen(port, "127.0.0.1", () =>
  console.log(`Preview: http://127.0.0.1:${port}/preview/`),
);
process.on("SIGTERM", () => server.close());
