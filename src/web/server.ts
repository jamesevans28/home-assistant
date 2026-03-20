import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "module";
import { getConfig } from "../config.js";
import { getLogger } from "../utils/logger.js";
import { buildDashboardData } from "./dashboardData.js";

let dashboardHtml: string | null = null;

function getHtml(): string {
  if (dashboardHtml) return dashboardHtml;

  // Try multiple resolution paths (bundled vs dev mode)
  const paths = [
    resolve(process.cwd(), "src/web/dashboard.html"),
    resolve(dirname(fileURLToPath(import.meta.url)), "../src/web/dashboard.html"),
    resolve(dirname(fileURLToPath(import.meta.url)), "../../src/web/dashboard.html"),
  ];

  for (const p of paths) {
    try {
      dashboardHtml = readFileSync(p, "utf-8");
      return dashboardHtml;
    } catch {
      // Try next path
    }
  }

  throw new Error("dashboard.html not found");
}

function getVersion(): string {
  const require = createRequire(import.meta.url);
  // Paths to try: bundled (dist/index.js → ../package.json) and dev (src/web/ → ../../package.json)
  try { return require("../package.json").version; } catch {}
  return require("../../package.json").version;
}

function checkAuth(req: IncomingMessage): boolean {
  const config = getConfig();
  if (!config.DASHBOARD_TOKEN) return true; // No token = open access

  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const token = url.searchParams.get("token");
  return token === config.DASHBOARD_TOKEN;
}

function sendJson(res: ServerResponse, status: number, data: unknown) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  });
  res.end(body);
}

function sendHtml(res: ServerResponse, html: string) {
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Cache-Control": "no-cache",
  });
  res.end(html);
}

export function startDashboard(port: number) {
  const log = getLogger();
  const startTime = Date.now();

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const path = url.pathname;

    // Health check — no auth required
    if (path === "/api/health") {
      sendJson(res, 200, {
        status: "ok",
        version: getVersion(),
        uptime: Math.floor((Date.now() - startTime) / 1000),
      });
      return;
    }

    // Auth check for all other routes
    if (!checkAuth(req)) {
      sendJson(res, 401, { error: "Unauthorized" });
      return;
    }

    if (path === "/api/dashboard") {
      try {
        const data = buildDashboardData();
        sendJson(res, 200, data);
      } catch (err) {
        log.error({ err }, "Dashboard data error");
        const message = err instanceof Error ? err.message : String(err);
        const stack = err instanceof Error ? err.stack : undefined;
        sendJson(res, 500, { error: "Internal server error", message, stack });
      }
      return;
    }

    if (path === "/") {
      try {
        sendHtml(res, getHtml());
      } catch (err) {
        log.error({ err }, "Failed to serve dashboard HTML");
        sendJson(res, 500, { error: "Dashboard HTML not found" });
      }
      return;
    }

    // 404
    sendJson(res, 404, { error: "Not found" });
  });

  server.listen(port, () => {
    log.info({ port }, "Dashboard server listening");
  });

  return server;
}
