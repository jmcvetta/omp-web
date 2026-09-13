import type { Hono } from "hono";
import { PushNotificationService } from "./PushNotificationService.js";
import { errorMessage, isRecord } from "../utils.js";

export function registerPushRoutes(app: Hono, push: PushNotificationService = new PushNotificationService()): void {
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

function requireSubscriptionBody(value: unknown): { endpoint: string; keys: { p256dh: string; auth: string } } {
  if (!isRecord(value)) throw new Error("Request body must be an object");
  if (typeof value["endpoint"] !== "string" || value["endpoint"] === "") throw new Error("endpoint is required");
  const keys = value["keys"];
  if (!isRecord(keys) || typeof keys["p256dh"] !== "string" || typeof keys["auth"] !== "string") {
    throw new Error("keys with p256dh and auth are required");
  }
  return { endpoint: value["endpoint"], keys: { p256dh: keys["p256dh"], auth: keys["auth"] } };
}
