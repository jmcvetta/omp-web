#!/usr/bin/env bun
import { effectiveOmpWebConfig, maxUploadBytes } from "../config.js";
import { buildApp } from "./app.js";

const { config } = effectiveOmpWebConfig();
const app = await buildApp({ bodyLimit: maxUploadBytes(process.env, config) });

const port = config.port ?? 8504;
const host = config.host ?? "127.0.0.1";

Bun.serve({
  port,
  hostname: host,
  fetch: app.hono.fetch,
  websocket: app.websocket,
  maxRequestBodySize: maxUploadBytes(process.env, config),
});

console.info(`PI WEB server listening on http://${host}:${String(port)}`);
