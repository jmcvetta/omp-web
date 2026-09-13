import { Hono } from "hono";

export interface TestResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  json<T = unknown>(): T;
}

export interface TestInjectOptions {
  method: string;
  url: string;
  payload?: unknown;
  headers?: Record<string, string>;
}

export class HonoTestApp {
  readonly app = new Hono();

  async inject(options: TestInjectOptions): Promise<TestResponse> {
    const isUint8Array = options.payload instanceof Uint8Array;
    const isJsonPayload = options.payload !== undefined && !isUint8Array;
    const headers: Record<string, string> = {
      ...(isJsonPayload ? { "content-type": "application/json" } : {}),
      ...options.headers,
    };

    let body: BodyInit | null = null;
    if (isUint8Array) {
      body = options.payload as unknown as BodyInit;
    } else if (options.payload !== undefined) {
      body = JSON.stringify(options.payload);
    }

    const init: RequestInit = {
      method: options.method,
      headers,
    };
    if (body !== null) {
      init.body = body;
    }

    const response = await this.app.request(options.url, init);
    const text = await response.text();
    return {
      statusCode: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: text,
      json<T = unknown>(): T {
        return JSON.parse(text);
      },
    };
  }

  async ready(): Promise<void> {}

  async close(): Promise<void> {
    // No-op for Hono in-memory app
  }
}
