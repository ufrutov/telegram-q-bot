/** One local server, same API handler as production. No webhook/cron routes. */
import { config } from "dotenv";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { createServer as createViteServer } from "vite";
import type { VercelRequest, VercelResponse } from "@vercel/node";

config({ path: ".env.local", quiet: true });
config({ quiet: true });
const { default: dashboard } = await import("../api/dashboard.js");
const preview = process.argv.includes("--preview");
const port = Number(process.env.PORT ?? 5173);
const vite = preview
  ? null
  : await createViteServer({
      configFile: "web/vite.config.ts",
      server: {
        middlewareMode: true,
        hmr: preview ? false : { port: port + 10000, host: "127.0.0.1" },
      },
      appType: "custom",
    });
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/api/dashboard") {
      let body: unknown;
      if (["POST", "PATCH", "DELETE"].includes(req.method ?? "")) {
        let raw = "";
        for await (const chunk of req) {
          raw += chunk.toString();
          if (Buffer.byteLength(raw) > 4096) {
            res.writeHead(413);
            res.end("Request too large");
            return;
          }
        }
        try {
          body = JSON.parse(raw);
        } catch {
          res.writeHead(400);
          res.end("Invalid JSON");
          return;
        }
      }
      const request = Object.assign(req, {
        query: Object.fromEntries(url.searchParams),
        body,
      }) as VercelRequest;
      const response = Object.assign(res, {
        status(code: number) {
          res.statusCode = code;
          return response;
        },
        json(value: unknown) {
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(value));
          return response;
        },
      }) as unknown as VercelResponse;
      await dashboard(request, response);
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    if (preview) {
      const { resolve, sep, extname } = await import("node:path");
      const root = resolve("dist/web");
      const path = resolve(
        root,
        `.${decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname)}`,
      );
      if (!path.startsWith(root + sep)) {
        res.writeHead(404);
        res.end();
        return;
      }
      try {
        const data = await readFile(path);
        res.setHeader(
          "Content-Type",
          (
            {
              ".html": "text/html",
              ".js": "text/javascript",
              ".css": "text/css",
              ".svg": "image/svg+xml",
            } as Record<string, string>
          )[extname(path)] ?? "application/octet-stream",
        );
        res.end(data);
      } catch {
        res.writeHead(404);
        res.end("Not found");
      }
      return;
    }
    vite!.middlewares(req, res, async () => {
      try {
        const html = await vite!.transformIndexHtml(
          req.url ?? "/",
          await readFile("web/index.html", "utf8"),
        );
        res.setHeader("Content-Type", "text/html");
        res.end(html);
      } catch (error) {
        console.error(error);
        res.writeHead(500);
        res.end("Local page failed to load");
      }
    });
  } catch (error) {
    console.error(error);
    if (!res.headersSent) res.writeHead(500);
    res.end("Local server error");
  }
});
server.listen(port, "127.0.0.1", () =>
  console.log(`Dashboard: http://localhost:${port}${preview ? " (production assets)" : ""}`),
);
async function close() {
  await vite?.close();
  server.close(() => process.exit(0));
}
process.on("SIGINT", close);
process.on("SIGTERM", close);
