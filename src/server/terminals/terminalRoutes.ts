import type { Hono } from "hono";
import type { UpgradeWebSocket } from "hono/ws";
import type { RawData } from "ws";
import { normalizeRequestCwd } from "../workingDirectory.js";
import type { TerminalCommandRun, TerminalCommandRunFilter, TerminalCommandRunStatus } from "../../shared/apiTypes.js";
import type { RunTerminalCommandOptions, TerminalInfo } from "./terminalService.js";
import { parseTerminalSize } from "./terminalSize.js";
import { isRecord } from "../utils.js";

export interface TerminalRouteService {
  list(cwd: string): TerminalInfo[];
  create(options: { cwd: string; name?: string; cols?: number; rows?: number }): TerminalInfo;
  closeForCwd(cwd: string): void;
  close(id: string): void;
  attach(id: string, handlers: { output: (data: string, replay: boolean) => void; exit: (exitCode: number | undefined) => void }): () => void;
  write(id: string, data: string): void;
  resize(id: string, cols: number, rows: number): void;
  continue(id: string): TerminalInfo;
  runCommand(options: RunTerminalCommandOptions): TerminalCommandRun;
  listCommandRuns(filter?: TerminalCommandRunFilter): TerminalCommandRun[];
  getCommandRun(runId: string): TerminalCommandRun | undefined;
  cancelCommandRun(runId: string): TerminalCommandRun;
}

export function registerTerminalRoutes(
  app: Hono,
  terminals: TerminalRouteService,
  prefix = "",
  upgradeWebSocket?: UpgradeWebSocket,
): void {
  app.get(`${prefix}/terminals`, (c) => {
    const cwd = c.req.query("cwd");
    if (cwd === undefined || cwd === "") return c.json({ error: "cwd query parameter is required" }, 400);
    try {
      return c.json(terminals.list(normalizeRequestCwd(cwd)));
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.post(`${prefix}/terminals`, async (c) => {
    try {
      const body = await c.req.json<{ cwd: string; name?: string; cols?: number; rows?: number }>();
      return c.json(terminals.create({ ...body, cwd: normalizeRequestCwd(body.cwd) }));
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.delete(`${prefix}/terminals`, (c) => {
    const cwd = c.req.query("cwd");
    if (cwd === undefined || cwd === "") return c.json({ error: "cwd query parameter is required" }, 400);
    try {
      terminals.closeForCwd(normalizeRequestCwd(cwd));
      return c.json({ closed: true });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.post(`${prefix}/terminal-command-runs`, async (c) => {
    try {
      const body = await c.req.json<RunTerminalCommandOptions>();
      return c.json(terminals.runCommand({ ...body, cwd: normalizeRequestCwd(body.cwd) }));
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.get(`${prefix}/terminal-command-runs`, (c) => {
    try {
      return c.json(terminals.listCommandRuns(parseCommandRunFilter(c.req.query())));
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.post(`${prefix}/terminal-command-runs/:runId/cancel`, (c) => {
    try {
      const runId = c.req.param("runId");
      return c.json(terminals.cancelCommandRun(runId));
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.get(`${prefix}/terminal-command-runs/:runId`, (c) => {
    const runId = c.req.param("runId");
    const run = terminals.getCommandRun(runId);
    if (run === undefined) return c.json({ error: "Terminal command run not found" }, 404);
    return c.json(run);
  });

  app.post(`${prefix}/terminals/:terminalId/continue`, (c) => {
    try {
      const terminalId = c.req.param("terminalId");
      return c.json(terminals.continue(terminalId));
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.delete(`${prefix}/terminals/:terminalId`, (c) => {
    const terminalId = c.req.param("terminalId");
    terminals.close(terminalId);
    return c.json({ closed: true });
  });

  if (upgradeWebSocket !== undefined) {
    app.get(`${prefix}/terminals/:terminalId/socket`, upgradeWebSocket((c) => {
      const terminalId = c.req.param("terminalId") ?? "";
      const cols = c.req.query("cols");
      const rows = c.req.query("rows");
      let detach: () => void = () => undefined;

      return {
        onOpen(_evt, ws) {
          try {
            const initialSize = parseTerminalSize(cols, rows);
            if (initialSize !== undefined) terminals.resize(terminalId, initialSize.cols, initialSize.rows);
            detach = terminals.attach(terminalId, {
              output: (data, replay) => {
                ws.send(JSON.stringify({ type: "output", data, replay }));
              },
              exit: (exitCode) => {
                ws.send(JSON.stringify({ type: "exit", exitCode }));
              },
            });
          } catch (error) {
            ws.send(JSON.stringify({ type: "error", message: error instanceof Error ? error.message : String(error) }));
            ws.close();
          }
        },
        onMessage(evt) {
          try {
            const message = parseClientMessage(evt.data as unknown as RawData | string | ArrayBuffer);
            if (message.type === "input") terminals.write(terminalId, message.data);
            if (message.type === "resize") terminals.resize(terminalId, message.cols, message.rows);
          } catch (error) {
            // ignore malformed client message
          }
        },
        onClose() {
          detach();
        },
        onError() {
          detach();
        },
      };
    }));
  }
}

type ClientTerminalMessage =
  | { type: "input"; data: string }
  | { type: "resize"; cols: number; rows: number };

interface TerminalCommandRunQuery {
  projectId?: string;
  workspaceId?: string;
  terminalId?: string;
  statuses?: string;
  metadata?: string;
}

function parseCommandRunFilter(query: TerminalCommandRunQuery): TerminalCommandRunFilter {
  const metadata = query.metadata === undefined || query.metadata === "" ? undefined : parseMetadataFilter(query.metadata);
  const statuses = query.statuses === undefined || query.statuses === "" ? undefined : query.statuses.split(",").filter((status) => status !== "").map(parseCommandRunStatus);
  return {
    ...(query.projectId === undefined ? {} : { projectId: query.projectId }),
    ...(query.workspaceId === undefined ? {} : { workspaceId: query.workspaceId }),
    ...(query.terminalId === undefined ? {} : { terminalId: query.terminalId }),
    ...(statuses === undefined ? {} : { statuses }),
    ...(metadata === undefined ? {} : { metadata }),
  };
}

function parseCommandRunStatus(value: string): TerminalCommandRunStatus {
  if (value !== "queued" && value !== "running" && value !== "succeeded" && value !== "failed") throw new Error(`Invalid command run status: ${value}`);
  return value;
}

function parseMetadataFilter(value: string): Record<string, string> {
  const parsed: unknown = JSON.parse(value);
  if (!isRecord(parsed) || Array.isArray(parsed)) throw new Error("metadata filter must be an object");
  return Object.fromEntries(Object.entries(parsed).map(([key, metadataValue]) => {
    if (typeof metadataValue !== "string") throw new Error(`metadata filter value must be a string: ${key}`);
    return [key, metadataValue];
  }));
}

function parseClientMessage(data: RawData | string | ArrayBuffer): ClientTerminalMessage {
  const value: unknown = JSON.parse(rawDataToString(data));
  if (!isRecord(value) || typeof value["type"] !== "string") throw new Error("Invalid terminal message");
  if (value["type"] === "input" && typeof value["data"] === "string") return { type: "input", data: value["data"] };
  if (value["type"] === "resize" && typeof value["cols"] === "number" && typeof value["rows"] === "number") return { type: "resize", cols: value["cols"], rows: value["rows"] };
  throw new Error("Invalid terminal message");
}

function rawDataToString(data: RawData | string | ArrayBuffer): string {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  return data.toString();
}
