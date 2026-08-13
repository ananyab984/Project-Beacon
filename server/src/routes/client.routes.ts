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
    const clients = await prisma.client.findMany({ orderBy: { name: "asc" } });
    return res.json({ clients });
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
