import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import worker from "./dist/server/index.js";

const root = dirname(fileURLToPath(import.meta.url));
const publicRoot = resolve(root, "dist/client");
const port = 5173;

const types = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};

async function assetsFetch(request) {
  const url = new URL(request.url);
  const pathname = decodeURIComponent(url.pathname);
  const filePath = resolve(publicRoot, `.${pathname}`);
  if (filePath !== publicRoot && !filePath.startsWith(`${publicRoot}${sep}`)) {
    return new Response("Not found", { status: 404 });
  }
  try {
    const data = await readFile(filePath);
    return new Response(data, {
      headers: {
        "content-type": types[extname(filePath).toLowerCase()] || "application/octet-stream",
        "cache-control": pathname.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

const server = createServer(async (incoming, outgoing) => {
  try {
    const chunks = [];
    for await (const chunk of incoming) chunks.push(chunk);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const request = new Request(`http://127.0.0.1:${port}${incoming.url || "/"}`, {
      method: incoming.method,
      headers: incoming.headers,
      body: incoming.method === "GET" || incoming.method === "HEAD" ? undefined : body,
    });
    const pathname = new URL(request.url).pathname;
    const response = pathname.startsWith("/assets/") || extname(pathname)
      ? await assetsFetch(request)
      : await worker.fetch(
          request,
          { ASSETS: { fetch: assetsFetch } },
          { waitUntil() {}, passThroughOnException() {} },
        );
    outgoing.statusCode = response.status;
    response.headers.forEach((value, key) => outgoing.setHeader(key, value));
    if (incoming.method === "HEAD") {
      outgoing.end();
      return;
    }
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    outgoing.statusCode = 500;
    outgoing.setHeader("content-type", "text/plain; charset=utf-8");
    outgoing.end("本地工具启动失败，请返回 Codex 寻求帮助。");
    console.error(error);
  }
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error("端口 5173 已被占用。请先关闭之前打开的无痕修图窗口。");
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});

server.listen(port, "127.0.0.1", () => {
  console.log(`无痕修图已启动：http://127.0.0.1:${port}`);
});
