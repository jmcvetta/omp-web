import type { Hono } from "hono";
import type { ProjectService } from "./projects/projectService.js";
import type { WorkspaceService } from "./workspaces/workspaceService.js";
import { resolveWorkspaceContext } from "./workspaces/workspaceContext.js";
import { gitDiff, gitStatus } from "./git/gitService.js";

export function registerGitRoutes(app: Hono, projects: ProjectService, workspaces: WorkspaceService, prefix = "/api"): void {
  app.get(`${prefix}/projects/:projectId/workspaces/:workspaceId/git/status`, async (c) => {
    try {
      const projectId = c.req.param("projectId");
      const workspaceId = c.req.param("workspaceId");
      const context = await resolveWorkspaceContext(projects, workspaces, projectId, workspaceId);
      return c.json(await gitStatus(context.root));
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.get(`${prefix}/projects/:projectId/workspaces/:workspaceId/git/diff`, async (c) => {
    try {
      const projectId = c.req.param("projectId");
      const workspaceId = c.req.param("workspaceId");
      const path = c.req.query("path");
      const staged = c.req.query("staged");
      const context = await resolveWorkspaceContext(projects, workspaces, projectId, workspaceId);
      return c.json(await gitDiff(context.root, { ...(path === undefined ? {} : { path }), staged: staged === "true" }));
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });
}
