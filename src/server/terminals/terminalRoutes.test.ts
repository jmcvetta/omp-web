import { resolve } from "node:path";
import type { Server } from "bun";
import { Hono } from "hono";
import { createBunWebSocket } from "hono/bun";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { WebSocket, type RawData } from "ws";
import type { TerminalCommandRun, TerminalCommandRunFilter } from "../../shared/apiTypes.js";
import type { RunTerminalCommandOptions, TerminalInfo } from "./terminalService.js";
import { registerTerminalRoutes, type TerminalRouteService } from "./terminalRoutes.js";

let app: Hono;
let server: Server<unknown>;
let terminals: FakeTerminals;

beforeEach(async () => {
  app = new Hono();
  const { upgradeWebSocket, websocket } = createBunWebSocket();
  terminals = new FakeTerminals();
  registerTerminalRoutes(app, terminals, "", upgradeWebSocket);
  server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: app.fetch,
    websocket,
  });
});

afterEach(async () => {
  server.stop(true);
});

describe("terminal routes", () => {
  it("applies the initial socket size before attaching and replaying output", async () => {
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}/terminals/t1/socket?cols=120.9&rows=40.2`);

    await expect(nextMessage(socket)).resolves.toBe(JSON.stringify({ type: "output", data: "replayed", replay: true }));
    expect(terminals.events).toEqual(["resize:t1:120x40", "attach:t1"]);

    socket.close();
  });

  it("closes all terminals for a cwd", async () => {
    // The route normalizes the request cwd, so the service receives the
    // resolved absolute path (drive-qualified on Windows).
    const requestCwd = resolve("/repo/worktree");
    const response = await injectRequest(app, { method: "DELETE", url: `/terminals?cwd=${encodeURIComponent(requestCwd)}` });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ closed: true });
    expect(terminals.events).toEqual([`close-cwd:${requestCwd}`]);
  });

  it("routes command-run create, filter, cancel, and terminal continue requests", async () => {
    const createResponse = await injectRequest(app, {
      method: "POST",
      url: "/terminal-command-runs",
      payload: { origin: "core", projectId: "p1", workspaceId: "w1", cwd: "/repo", title: "Build", command: "npm test", metadata: { "pi.operation": "test" } },
    });

    expect(createResponse.statusCode).toBe(200);
    expect(createResponse.json<TerminalCommandRun>()).toMatchObject({ id: "run1", projectId: "p1", workspaceId: "w1", status: "running" });

    const listResponse = await injectRequest(app, { method: "GET", url: `/terminal-command-runs?projectId=p1&statuses=running&metadata=${encodeURIComponent(JSON.stringify({ "pi.operation": "test" }))}` });

    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json<TerminalCommandRun[]>()).toHaveLength(1);

    const cancelResponse = await injectRequest(app, { method: "POST", url: "/terminal-command-runs/run1/cancel" });
    expect(cancelResponse.statusCode).toBe(200);
    expect(terminals.events).toContain("cancel:run1");

    const continueResponse = await injectRequest(app, { method: "POST", url: "/terminals/t-run/continue" });
    expect(continueResponse.statusCode).toBe(200);
    expect(terminals.events).toContain("continue:t-run");
  });
});

async function injectRequest(
  honoApp: Hono,
  options: { method: string; url: string; payload?: unknown },
): Promise<{ statusCode: number; json<T = unknown>(): T }> {
  const init: RequestInit = {
    method: options.method,
    headers: options.payload !== undefined ? { "content-type": "application/json" } : {},
    body: options.payload !== undefined ? JSON.stringify(options.payload) : undefined,
  };
  const res = await honoApp.request(options.url, init);
  const text = await res.text();
  return {
    statusCode: res.status,
    json<T = unknown>(): T {
      return JSON.parse(text);
    },
  };
}

class FakeTerminals implements TerminalRouteService {
  readonly events: string[] = [];
  private readonly runs = new Map<string, TerminalCommandRun>();
  private readonly listeners = new Map<string, { output: (data: string, replay: boolean) => void; exit: (exitCode: number | undefined) => void }>();

  list(_cwd: string): TerminalInfo[] {
    return [];
  }

  create(_options: { cwd: string; name?: string; cols?: number; rows?: number }): TerminalInfo {
    return { id: "t1", title: "Terminal", processId: 10, cwd: "/repo" };
  }

  closeForCwd(cwd: string): void {
    this.events.push(`close-cwd:${cwd}`);
  }

  close(id: string): void {
    this.events.push(`close:${id}`);
  }

  attach(id: string, handlers: { output: (data: string, replay: boolean) => void; exit: (exitCode: number | undefined) => void }): () => void {
    this.events.push(`attach:${id}`);
    this.listeners.set(id, handlers);
    handlers.output("replayed", true);
    return () => {
      this.events.push(`detach:${id}`);
      this.listeners.delete(id);
    };
  }

  write(id: string, data: string): void {
    this.events.push(`write:${id}:${data}`);
  }

  resize(id: string, cols: number, rows: number): void {
    this.events.push(`resize:${id}:${cols}x${rows}`);
  }

  continue(id: string): TerminalInfo {
    this.events.push(`continue:${id}`);
    return { id, title: "Continued", processId: 12, cwd: "/repo" };
  }

  runCommand(options: RunTerminalCommandOptions): TerminalCommandRun {
    const run: TerminalCommandRun = {
      id: "run1",
      origin: options.origin,
      projectId: options.projectId,
      workspaceId: options.workspaceId,
      terminalId: "t-run",
      title: options.title,
      command: options.command,
      status: "running",
      exitCode: null,
      error: null,
      startedAt: "2026-03-31T00:00:00.000Z",
      finishedAt: null,
      metadata: routeMetadata(options.metadata),
    };
    this.runs.set(run.id, run);
    return run;
  }

  listCommandRuns(_filter?: TerminalCommandRunFilter): TerminalCommandRun[] {
    return Array.from(this.runs.values());
  }

  getCommandRun(runId: string): TerminalCommandRun | undefined {
    return this.runs.get(runId);
  }

  cancelCommandRun(runId: string): TerminalCommandRun {
    const run = this.runs.get(runId);
    if (run === undefined) throw new Error("not found");
    run.status = "failed";
    this.events.push(`cancel:${runId}`);
    return run;
  }
}

function routeMetadata(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

function nextMessage(socket: WebSocket): Promise<string> {
  return new Promise((resolve) => {
    socket.once("message", (data) => {
      resolve(rawDataToString(data));
    });
  });
}

function rawDataToString(data: RawData): string {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  return data.toString("utf8");
}
