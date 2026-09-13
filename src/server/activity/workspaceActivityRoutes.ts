import type { Hono } from "hono";
import type { WorkspaceActivityResponse } from "../../shared/apiTypes.js";

export interface WorkspaceActivityRouteService {
  snapshot(): WorkspaceActivityResponse;
}

export function registerWorkspaceActivityRoutes(app: Hono, activity: WorkspaceActivityRouteService, prefix = ""): void {
  app.get(`${prefix}/activity`, (c) => c.json(activity.snapshot()));
}
