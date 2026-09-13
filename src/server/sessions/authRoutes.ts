import type { Hono } from "hono";
import type { AuthService } from "./authService.js";

export function registerAuthRoutes(app: Hono, auth: AuthService, prefix = ""): void {
  app.get(`${prefix}/auth/providers`, async (c) => {
    try {
      const mode = c.req.query("mode");
      const authType = c.req.query("authType");
      const providers = await auth.authProviders(
        mode === "logout" ? "logout" : "login",
        authType === "oauth" || authType === "api_key" ? authType : undefined,
      );
      return c.json(providers);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 404);
    }
  });

  app.post(`${prefix}/auth/api-key`, async (c) => {
    try {
      const body = await c.req.json<{ providerId: string; key: string }>();
      const result = await auth.saveApiKey(body.providerId, body.key);
      return c.json(result);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.post(`${prefix}/auth/logout`, async (c) => {
    try {
      const body = await c.req.json<{ providerId: string }>();
      const result = await auth.logoutProvider(body.providerId);
      return c.json(result);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.post(`${prefix}/auth/oauth`, async (c) => {
    try {
      const body = await c.req.json<{ providerId: string }>();
      const result = auth.startOAuthLogin(body.providerId);
      return c.json(result);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.get(`${prefix}/auth/oauth/:flowId`, async (c) => {
    try {
      const flowId = c.req.param("flowId");
      const flow = auth.oauthFlow(flowId);
      return c.json(flow);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 404);
    }
  });

  app.post(`${prefix}/auth/oauth/:flowId/respond`, async (c) => {
    try {
      const flowId = c.req.param("flowId");
      const body = await c.req.json<{ requestId: string; value: string }>();
      const result = auth.respondToOAuthFlow(flowId, body.requestId, body.value);
      return c.json(result);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.post(`${prefix}/auth/oauth/:flowId/cancel`, async (c) => {
    try {
      const flowId = c.req.param("flowId");
      const result = auth.cancelOAuthFlow(flowId);
      return c.json(result);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });
}
