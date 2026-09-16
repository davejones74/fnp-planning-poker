import { createServer, type IncomingMessage } from "node:http";
import { type ServerResponse } from "node:http";
import {
  existsSync,
  readFileSync,
  statSync,
} from "node:fs";
import { extname, join, normalize } from "node:path";
import { WebSocketServer } from "ws";
import { WebSocket } from "ws";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { wrap, type HttpHandler } from "./shared/http.ts";
import { rooms, realtime } from "./services/index.ts";
import type { ClientMessage } from "../../shared/types.ts";

import { createRoom } from "./functions/createRoom.ts";
import { getRoom } from "./functions/getRoom.ts";
import { joinRoom as joinRoomFn } from "./functions/joinRoom.ts";
import { vote } from "./functions/vote.ts";
import { reveal } from "./functions/reveal.ts";
import { newRound as newRoundFn } from "./functions/newRound.ts";
import { updateStory } from "./functions/updateStory.ts";
import { removeParticipant } from "./functions/removeParticipant.ts";
import { getParticipants } from "./functions/getParticipants.ts";
import { negotiate } from "./functions/negotiate.ts";
import { me } from "./functions/me.ts";
import { health } from "./functions/health.ts";
import { jiraAuthorize } from "./functions/jiraAuthorize.ts";
import { jiraCallback } from "./functions/jiraCallback.ts";
import { jiraStatus } from "./functions/jiraStatus.ts";
import { jiraFeed } from "./functions/jiraFeed.ts";
import { clientConfig } from "./functions/config.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = normalize(join(__dirname, "..", ".."));
const FRONTEND_DIR = join(ROOT_DIR, "dist", "frontend");

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

interface Route {
  method: string;
  pattern: RegExp;
  handler: HttpHandler;
}

const routes: Route[] = [
  { method: "POST", pattern: /^\/api\/rooms$/, handler: wrap(createRoom) },
  { method: "GET", pattern: /^\/api\/rooms\/([A-Z0-9]{6})(?:\/)?$/, handler: wrap(getRoom) },
  { method: "GET", pattern: /^\/api\/rooms\/([A-Z0-9]{6})\/participants$/, handler: wrap(getParticipants) },
  { method: "POST", pattern: /^\/api\/rooms\/([A-Z0-9]{6})\/join$/, handler: wrap(joinRoomFn) },
  { method: "POST", pattern: /^\/api\/rooms\/([A-Z0-9]{6})\/vote$/, handler: wrap(vote) },
  { method: "POST", pattern: /^\/api\/rooms\/([A-Z0-9]{6})\/reveal$/, handler: wrap(reveal) },
  { method: "POST", pattern: /^\/api\/rooms\/([A-Z0-9]{6})\/round$/, handler: wrap(newRoundFn) },
  { method: "PUT", pattern: /^\/api\/rooms\/([A-Z0-9]{6})\/story$/, handler: wrap(updateStory) },
  { method: "POST", pattern: /^\/api\/rooms\/([A-Z0-9]{6})\/participants\/remove$/, handler: wrap(removeParticipant) },
  { method: "GET", pattern: /^\/api\/negotiate$/, handler: wrap(negotiate) },
  { method: "POST", pattern: /^\/api\/negotiate$/, handler: wrap(negotiate) },
  { method: "GET", pattern: /^\/api\/jira\/authorize$/, handler: wrap(jiraAuthorize) },
  { method: "GET", pattern: /^\/api\/jira\/callback$/, handler: wrap(jiraCallback) },
  { method: "GET", pattern: /^\/api\/jira\/status$/, handler: wrap(jiraStatus) },
  { method: "POST", pattern: /^\/api\/jira\/feed$/, handler: wrap(jiraFeed) },
  { method: "GET", pattern: /^\/api\/config$/, handler: wrap(clientConfig) },
  { method: "GET", pattern: /^\/api\/me$/, handler: wrap(me) },
  { method: "GET", pattern: /^\/health$/, handler: wrap(health) },
];

function findRoute(req: IncomingMessage): Route | null {
  const method = req.method ?? "GET";
  const pathname = buildUrl(req).pathname;
  for (const route of routes) {
    if (route.method === method && route.pattern.test(pathname)) {
      return route;
    }
  }
  return null;
}

function buildUrl(req: IncomingMessage): URL {
  const proto =
    req.headers["x-forwarded-proto"]?.toString().split(",")[0]?.trim() ?? "http";
  const host = req.headers.host ?? "localhost:8080";
  return new URL(`${proto}://${host}${req.url ?? "/"}`);
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk as Buffer));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function toServerResponse(
  handler: HttpHandler,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = buildUrl(req);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (key === "host") continue;
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v);
    } else {
      headers.set(key, value);
    }
  }
  const body = req.method !== "GET" && req.method !== "HEAD"
    ? await readBody(req)
    : undefined;
  const request = new Request(url.toString(), {
    method: req.method,
    headers,
    ...(body && body.length > 0
      ? { body: new Uint8Array(body) }
      : {}),
  });
  const response = await handler(request);
  res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
  res.end(await response.text());
}

// ── Static file serving ──────────────────────────────────────────────────────

function serveStatic(pathname: string, res: ServerResponse): boolean {
  const requestPath = pathname === "/" ? "/index.html" : pathname;
  const safe = join(FRONTEND_DIR, requestPath);
  if (!safe.startsWith(FRONTEND_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return true;
  }
  const serve = (filePath: string) => {
    const content = readFileSync(filePath);
    const ext = extname(filePath);
    const mime = MIME_TYPES[ext] ?? "application/octet-stream";
    res.writeHead(200, { "content-type": mime });
    res.end(content);
  };
  if (existsSync(safe) && statSync(safe).isFile()) {
    serve(safe);
    return true;
  }
  if (existsSync(join(FRONTEND_DIR, "index.html"))) {
    serve(join(FRONTEND_DIR, "index.html"));
    return true;
  }
  res.writeHead(404);
  res.end("Not Found");
  return true;
}

// ── WebSocket ────────────────────────────────────────────────────────────────

const wss = new WebSocketServer({ noServer: true });

wss.on("connection", (socket: WebSocket) => {
  socket.on("message", async (data) => {
    try {
      const msg = JSON.parse(data.toString()) as ClientMessage;
      if (
        msg.type === "connect" &&
        typeof msg.roomCode === "string" &&
        typeof msg.participantId === "string"
      ) {
        await rooms.getParticipant(msg.roomCode, msg.participantId); // throws if invalid
        await rooms.handleConnect(msg.roomCode, msg.participantId);
        realtime.bind(socket, msg.roomCode.toUpperCase(), msg.participantId);
      }
    } catch {
      socket.close(1008, "Invalid connect payload");
    }
  });

  socket.on("close", () => {
    const binding = realtime.unbind(socket);
    if (binding) {
      void rooms.handleDisconnect(binding.roomCode, binding.participantId);
    }
  });
});

// ── Server ───────────────────────────────────────────────────────────────────

const PORT = Number(process.env.PORT ?? "8080");

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname.startsWith("/api/") || url.pathname === "/health") {
    const route = findRoute(req);
    if (route) {
      await toServerResponse(route.handler, req, res);
    } else {
      res.writeHead(404);
      res.end(
        JSON.stringify({
          error: { code: "NOT_FOUND", message: "Endpoint not found." },
        }),
      );
    }
  } else {
    serveStatic(url.pathname, res);
  }
});

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname !== "/ws") {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req);
  });
});

server.listen(PORT, () => {
  console.log(`Scrum Poker dev server  http://localhost:${PORT}`);
});