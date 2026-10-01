import { Router, Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { authenticateJwt } from "../middleware/auth";
import { requireRole, Role } from "../middleware/rbac";
import { asyncHandler } from "../lib/asyncHandler";
import { ApiError } from "../lib/apiError";

export const escalationRouter = Router();

escalationRouter.use(authenticateJwt);

// GET /api/escalations — owner sees all (P1 first, then createdAt desc);
// recruiter sees only their own. EscalationPriority is declared P1, P2, P3
// in schema.prisma, so Prisma's enum `asc` ordering (declaration order)
// already sorts P1 before P2 before P3 — a single orderBy is sufficient,
// no need for separate per-priority queries.
escalationRouter.get(
  "/",
  requireRole("owner", "recruiter"),
  asyncHandler(async (req: Request, res: Response) => {
    const role = req.user!.role.toLowerCase() as Role;

    const where = role === "recruiter" ? { recruiterId: req.user!.id } : {};

    const escalations = await prisma.escalation.findMany({
      where,
      orderBy: [{ priority: "asc" }, { createdAt: "desc" }],
    });

    return res.json({ escalations });
  })
);

// PATCH /api/escalations/:id — status transition and/or self-assign.
// Owners may update any escalation; recruiters may only update escalations
// that belong to them (recruiterId === req.user.id).
escalationRouter.patch(
  "/:id",
  requireRole("owner", "recruiter"),
  asyncHandler(async (req: Request, res: Response) => {
    const schema = z.object({
      status: z.enum(["OPEN", "ACKNOWLEDGED", "IN_PROGRESS"]).optional(),
      assignToMe: z.boolean().optional(),
    });
    const { status, assignToMe } = schema.parse(req.body);

    const existing = await prisma.escalation.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new ApiError(404, "ESCALATION_NOT_FOUND", "Escalation not found");

    const role = req.user!.role.toLowerCase() as Role;
    if (role === "recruiter" && existing.recruiterId !== req.user!.id) {
      throw new ApiError(403, "FORBIDDEN", "Recruiters can only update their own escalations");
    }

    const updated = await prisma.escalation.update({
      where: { id: existing.id },
      data: {
        ...(status ? { status } : {}),
        ...(assignToMe ? { ownerUserId: req.user!.id } : {}),
      },
    });

    return res.json({ escalation: updated });
  })
);
