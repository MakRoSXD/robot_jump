// Локальний стенд: node tools/serve.mjs → http://localhost:8770/
// Лише для перевірки на своєму ПК; на GitHub Pages гра — це просто статичні файли.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const PORT = Number(process.env.PORT) || 8770;
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".woff2": "font/woff2", ".png": "image/png",
  ".svg": "image/svg+xml", ".json": "application/json", ".md": "text/plain; charset=utf-8"
};

createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p.endsWith("/")) p += "index.html";
    const file = normalize(join(ROOT, p));
    if (file !== ROOT && !file.startsWith(ROOT + sep)) { res.writeHead(403).end(); return; }
    const body = await readFile(file);
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
}).listen(PORT, () => console.log("http://localhost:" + PORT + "/"));
