import type { FastifyInstance, FastifyReply } from "fastify";
import type { Hono } from "hono";
import { PushNotificationService } from "./PushNotificationService.js";
import { errorMessage, isRecord } from "../utils.js";

export function registerPushRoutes(app: Hono | FastifyInstance, push: PushNotificationService = new PushNotificationService()): void {
  if (isFastifyInstance(app)) {
    registerFastifyPushRoutes(app, push);
  } else {
    registerHonoPushRoutes(app, push);
  }
}

function isFastifyInstance(app: Hono | FastifyInstance): app is FastifyInstance {
  return "register" in app && typeof app.register === "function";
}

function registerHonoPushRoutes(app: Hono, push: PushNotificationService): void {
  app.get("/api/push/vapid-public-key", (c) => c.json({ publicKey: push.publicKey }));

  app.post("/api/push/subscribe", async (c) => {
    try {
      const rawBody: unknown = await c.req.json();
      const body = requireSubscriptionBody(rawBody);
      push.subscribe(body.endpoint, body.keys, c.req.header("user-agent"));
      return c.json({ ok: true }, 201);
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 400);
    }
  });

  app.delete("/api/push/subscribe", async (c) => {
    try {
      const endpoint = c.req.query("endpoint");
      if (typeof endpoint !== "string" || endpoint === "") {
        return c.json({ error: "endpoint query parameter is required" }, 400);
      }
      push.unsubscribe(endpoint);
      return c.json({ ok: true });
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 400);
    }
  });

  app.post("/api/push/test", async (c) => {
    try {
      await push.notify("Test notification", "This is a test push notification from omp-web.", "/");
      return c.json({ ok: true });
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 500);
    }
  });
}

function registerFastifyPushRoutes(app: FastifyInstance, push: PushNotificationService): void {
  app.get("/api/push/vapid-public-key", () => ({ publicKey: push.publicKey }));

  app.post<{ Body: unknown }>("/api/push/subscribe", async (request, reply) => {
    try {
      const body = requireSubscriptionBody(request.body);
      push.subscribe(body.endpoint, body.keys, request.headers["user-agent"]);
      await reply.code(201).send({ ok: true });
      return;
    } catch (error) {
      return reply.code(400).send({ error: errorMessage(error) });
    }
  });

  app.delete<{ Querystring: { endpoint: string } }>("/api/push/subscribe", async (request, reply) => {
    try {
      const endpoint = request.query.endpoint;
      if (typeof endpoint !== "string" || endpoint === "") {
        await reply.code(400).send({ error: "endpoint query parameter is required" });
        return;
      }
      push.unsubscribe(endpoint);
      return { ok: true };
    } catch (error) {
      return reply.code(400).send({ error: errorMessage(error) });
    }
  });

  app.post("/api/push/test", async (_request, reply) => {
    try {
      await push.notify("Test notification", "This is a test push notification from omp-web.", "/");
      return { ok: true };
    } catch (error) {
      return reply.code(500).send({ error: errorMessage(error) });
    }
  });
}

function requireSubscriptionBody(value: unknown): { endpoint: string; keys: { p256dh: string; auth: string } } {
  if (!isRecord(value)) throw new Error("Request body must be an object");
  if (typeof value["endpoint"] !== "string" || value["endpoint"] === "") throw new Error("endpoint is required");
  const keys = value["keys"];
  if (!isRecord(keys) || typeof keys["p256dh"] !== "string" || typeof keys["auth"] !== "string") {
    throw new Error("keys with p256dh and auth are required");
  }
  return { endpoint: value["endpoint"], keys: { p256dh: keys["p256dh"], auth: keys["auth"] } };
}
