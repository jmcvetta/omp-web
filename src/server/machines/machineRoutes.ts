import type { Hono } from "hono";
import { MachineService, type CreateMachineInput, type UpdateMachineInput } from "./machineService.js";
import { errorMessage } from "../utils.js";

export function registerMachineRoutes(app: Hono, machines = new MachineService()): void {
  app.get("/api/machines", async (c) => c.json({ machines: await machines.list() }));

  app.post("/api/machines", async (c) => {
    try {
      const body = await c.req.json<CreateMachineInput>();
      return c.json(await machines.add(body));
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 400);
    }
  });

  app.get("/api/machines/:machineId/health", async (c) => {
    const machineId = c.req.param("machineId");
    const health = await machines.health(machineId);
    if (health === undefined) return c.json({ error: "Machine not found" }, 404);
    return c.json(health);
  });

  app.get("/api/machines/:machineId/runtime", async (c) => {
    const machineId = c.req.param("machineId");
    const runtime = await machines.runtime(machineId);
    if (runtime === undefined) return c.json({ error: "Machine not found" }, 404);
    return c.json(runtime);
  });

  app.get("/api/machines/:machineId", async (c) => {
    const machineId = c.req.param("machineId");
    const machine = await machines.get(machineId);
    if (machine === undefined) return c.json({ error: "Machine not found" }, 404);
    return c.json(machine);
  });

  app.patch("/api/machines/:machineId", async (c) => {
    try {
      const machineId = c.req.param("machineId");
      const body = await c.req.json<UpdateMachineInput>();
      const machine = await machines.update(machineId, body);
      if (machine === undefined) return c.json({ error: "Machine not found" }, 404);
      return c.json(machine);
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 400);
    }
  });

  app.delete("/api/machines/:machineId", async (c) => {
    try {
      const machineId = c.req.param("machineId");
      const removed = await machines.remove(machineId);
      if (!removed) return c.json({ error: "Machine not found" }, 404);
      return c.json({ deleted: true });
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 400);
    }
  });
}
