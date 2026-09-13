import { WebSocket } from "ws";
import { sessiondHttpUrl, sessiondSocketPath } from "./config.js";

export class SessionDaemonClient {
  private readonly baseUrl = sessiondHttpUrl();
  private readonly socketPath = sessiondSocketPath();

  async request(method: string, path: string, body?: unknown): Promise<{ statusCode: number; headers: Record<string, string>; body: string }> {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const init: RequestInit = {
      method,
      ...(payload !== undefined && payload !== ""
        ? { headers: { "content-type": "application/json" }, body: payload }
        : {}),
    };

    const hasBaseUrl = this.baseUrl !== undefined && this.baseUrl !== "";
    const url = hasBaseUrl ? new URL(path, this.baseUrl) : new URL(path, "http://localhost");
    const response = await fetch(url, hasBaseUrl ? init : { ...init, unix: this.socketPath });

    return {
      statusCode: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: await response.text(),
    };
  }

  connectWebSocket(path: string): WebSocket {
    if (this.baseUrl !== undefined && this.baseUrl !== "") {
      const url = new URL(path, this.baseUrl);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      return new WebSocket(url);
    }
    return new WebSocket(`ws+unix:${this.socketPath}:${path}`);
  }
}
