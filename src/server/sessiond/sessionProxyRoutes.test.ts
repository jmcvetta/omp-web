import type { Server } from "bun";
import { Hono } from "hono";
import { createBunWebSocket } from "hono/bun";
import { WebSocket, WebSocketServer } from "ws";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { registerSessionProxyRoutes } from "./sessionProxyRoutes.js";

let app: Hono;
let server: Server<unknown> | undefined;
let daemon: FakeSessionDaemon;

beforeEach(async () => {
  app = new Hono();
  const { upgradeWebSocket, websocket } = createBunWebSocket();
  daemon = await FakeSessionDaemon.create();
  registerSessionProxyRoutes(app, daemon, "/api/machines/local", upgradeWebSocket);
  server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: app.fetch,
    websocket,
  });
});

afterEach(async () => {
  server?.stop(true);
  await daemon.close();
});

describe("machine-scoped session proxy routes", () => {
  it("strips the machine prefix before forwarding session requests", async () => {
    const res = await app.request("/api/machines/local/sessions?cwd=/repo");
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true });
    expect(daemon.requests).toEqual([{ method: "GET", path: "/sessions?cwd=/repo", body: undefined }]);
  });

  it("strips the machine prefix before forwarding auth requests", async () => {
    const res = await app.request("/api/machines/local/auth/api-key", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ providerId: "p", key: "k" }),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true });
    expect(daemon.requests).toEqual([{ method: "POST", path: "/auth/api-key", body: { providerId: "p", key: "k" } }]);
  });

  it("preserves cwd query context when forwarding session event websockets", async () => {
    const socket = new WebSocket(`ws://127.0.0.1:${server?.port}/api/machines/local/sessions/session-1/events?cwd=${encodeURIComponent("/repo")}`);

    try {
      await waitForOpen(socket);
      expect(daemon.websocketPaths).toEqual(["/sessions/session-1/events?cwd=%2Frepo"]);
    } finally {
      socket.close();
    }
  });
});

class FakeSessionDaemon {
  readonly requests: { method: string; path: string; body: unknown }[] = [];
  readonly websocketPaths: string[] = [];
  private readonly sockets = new Set<WebSocket>();

  private constructor(private readonly upstream: WebSocketServer) {
    this.upstream.on("connection", (socket) => {
      this.sockets.add(socket);
      socket.on("close", () => { this.sockets.delete(socket); });
    });
  }

  static async create(): Promise<FakeSessionDaemon> {
    const upstream = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await waitForListening(upstream);
    return new FakeSessionDaemon(upstream);
  }

  request(method: string, path: string, body?: unknown): Promise<{ statusCode: number; headers: Record<string, string>; body: string }> {
    this.requests.push({ method, path, body });
    return Promise.resolve({
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: true }),
    });
  }

  connectWebSocket(path: string): WebSocket {
    this.websocketPaths.push(path);
    return new WebSocket(`${webSocketServerUrl(this.upstream)}${path}`);
  }

  async close(): Promise<void> {
    for (const socket of this.sockets) socket.terminate();
    await closeWebSocketServer(this.upstream);
  }
}

function webSocketServerUrl(wsServer: WebSocketServer): string {
  const address = wsServer.address();
  if (address === null || typeof address === "string") throw new Error("Expected TCP server address");
  return `ws://127.0.0.1:${String(address.port)}`;
}

function waitForListening(wsServer: WebSocketServer): Promise<void> {
  return new Promise((resolve) => {
    wsServer.once("listening", () => { resolve(); });
  });
}

function closeWebSocketServer(wsServer: WebSocketServer): Promise<void> {
  return new Promise((resolve, reject) => {
    wsServer.close((error) => {
      if (error !== undefined) reject(error);
      else resolve();
    });
  });
}

function waitForOpen(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.OPEN) return Promise.resolve();
  return new Promise((resolve, reject) => {
    socket.once("open", () => { resolve(); });
    socket.once("error", reject);
    socket.once("close", () => { reject(new Error("WebSocket closed before opening")); });
  });
}
