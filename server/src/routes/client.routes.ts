import { Router, Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { authenticateJwt } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { asyncHandler } from "../lib/asyncHandler";

export const clientRouter = Router();

clientRouter.use(authenticateJwt);

const createClientSchema = z.object({
  name: z.string().min(1).max(160),
  industry: z.string().max(160).optional(),
  contactName: z.string().max(160).optional(),
  contactEmail: z.string().email().optional(),
  notes: z.string().optional(),
});

// GET /api/clients — list all clients (bounded table, no pagination needed)
clientRouter.get(
  "/",
  requireRole("owner", "recruiter"),
  asyncHandler(async (req: Request, res: Response) => {
    const clients = await prisma.client.findMany({
      include: {
        _count: {
          select: { demands: true, requirements: true },
        },
      },
      orderBy: { name: "asc" },
    });
    return res.json({ clients });
  })
);

// GET /api/clients/:id — single client detail with demands and requirements
clientRouter.get(
  "/:id",
  requireRole("owner", "recruiter"),
  asyncHandler(async (req: Request, res: Response) => {
    const client = await prisma.client.findUnique({
      where: { id: req.params.id },
      include: {
        demands: { include: { serviceBreakdown: true } },
        requirements: { include: { recruiter: { select: { name: true } } } },
      },
    });
    if (!client) {
      return res.status(404).json({ error: "CLIENT_NOT_FOUND", message: "Client not found" });
    }
    return res.json({ client });
  })
);

// POST /api/clients — find-or-create by case-insensitive name match
clientRouter.post(
  "/",
  requireRole("owner", "recruiter"),
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = createClientSchema.parse(req.body);

    const existing = await prisma.client.findFirst({
      where: { name: { equals: parsed.name, mode: "insensitive" } },
    });
    if (existing) {
      return res.status(200).json({ client: existing });
    }

    const client = await prisma.client.create({ data: parsed });
    return res.status(201).json({ client });
  })
);

// PATCH /api/clients/:id — update client details
clientRouter.patch(
  "/:id",
  requireRole("owner", "recruiter"),
  asyncHandler(async (req: Request, res: Response) => {
    const updateSchema = createClientSchema.partial();
    const patch = updateSchema.parse(req.body);

    const existing = await prisma.client.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      return res.status(404).json({ error: "CLIENT_NOT_FOUND", message: "Client not found" });
    }

    const updated = await prisma.client.update({
      where: { id: req.params.id },
      data: patch,
    });
    return res.json({ client: updated });
  })
);

// DELETE /api/clients/:id — delete client (owner only)
clientRouter.delete(
  "/:id",
  requireRole("owner"),
  asyncHandler(async (req: Request, res: Response) => {
    const existing = await prisma.client.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      return res.status(404).json({ error: "CLIENT_NOT_FOUND", message: "Client not found" });
    }

    await prisma.client.delete({ where: { id: req.params.id } });
    return res.json({ success: true, message: "Client deleted successfully" });
  })
);
