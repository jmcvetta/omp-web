import type { Hono } from "hono";
import type { PiPackageScope } from "../shared/apiTypes.js";
import { createDefaultPiPackageService, type PiPackageService } from "./piPackageService.js";
import { errorMessage, isRecord } from "./utils.js";

class PiPackageRequestValidationError extends Error { }

export function registerPiPackageRoutes(app: Hono, service: PiPackageService = createDefaultPiPackageService(), prefix = "/api"): void {
  const routePrefix = normalizeRoutePrefix(prefix);

  app.get(`${routePrefix}/pi-packages`, async (c) => {
    try {
      return c.json(await service.list());
    } catch (error) {
      return sendPiPackageError(c, error);
    }
  });

  app.post(`${routePrefix}/pi-packages/install`, async (c) => {
    try {
      const body = await c.req.json().catch(() => undefined);
      return c.json(await service.install(parseRequiredSourceRequest(body)));
    } catch (error) {
      return sendPiPackageError(c, error);
    }
  });

  app.post(`${routePrefix}/pi-packages/remove`, async (c) => {
    try {
      const rawBody = await c.req.json().catch(() => undefined);
      const body = requireRequestObject(rawBody);
      return c.json(await service.remove(parseRequiredSource(body["source"]), parseOptionalScope(body["scope"])));
    } catch (error) {
      return sendPiPackageError(c, error);
    }
  });

  app.post(`${routePrefix}/pi-packages/update`, async (c) => {
    try {
      const rawBody = await c.req.json().catch(() => undefined);
      const source = parseOptionalUpdateSource(rawBody);
      return c.json(source === undefined ? await service.update() : await service.update(source));
    } catch (error) {
      return sendPiPackageError(c, error);
    }
  });
}

function normalizeRoutePrefix(prefix: string): string {
  const normalized = prefix.replace(/\/+$/u, "");
  return normalized === "" ? "/api" : normalized;
}

function parseRequiredSourceRequest(body: unknown): string {
  const request = requireRequestObject(body);
  if (request["scope"] !== undefined || request["local"] !== undefined) {
    throw new PiPackageRequestValidationError("Pi package install scope is not supported; installs use Pi's default package location");
  }
  return parseRequiredSource(request["source"]);
}

function parseRequiredSource(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") throw new PiPackageRequestValidationError("Pi package source must be a non-empty string");
  return value.trim();
}

function parseOptionalUpdateSource(body: unknown): string | undefined {
  if (body === undefined) return undefined;
  const source = requireRequestObject(body)["source"];
  if (source === undefined) return undefined;
  return parseRequiredSource(source);
}

function parseOptionalScope(value: unknown): PiPackageScope | undefined {
  if (value === undefined) return undefined;
  if (value !== "user" && value !== "project") throw new PiPackageRequestValidationError("Pi package scope must be \"user\" or \"project\"");
  return value;
}

function requireRequestObject(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new PiPackageRequestValidationError("Pi package request body must be an object");
  return value;
}

function sendPiPackageError(c: { json(body: unknown, status?: number): Response }, error: unknown): Response {
  const status = error instanceof PiPackageRequestValidationError ? 400 : 500;
  return c.json({ error: errorMessage(error) }, status);
}
