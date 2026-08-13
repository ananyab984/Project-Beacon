import { Router, Request, Response } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { authenticateJwt } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { asyncHandler } from "../lib/asyncHandler";
import { ApiError } from "../lib/apiError";

export const requirementRouter = Router();

requirementRouter.use(authenticateJwt);

const PRIORITIES = ["STANDARD", "HIGH", "CRITICAL"] as const;

const requirementItemSchema = z.object({
  title: z.string().min(1).max(200),
  language: z.string().min(1),
  service: z.string().min(1),
  region: z.string().optional(),
  projectName: z.string().optional(),
  headcountNeeded: z.number().int().min(0),
  priority: z.enum(PRIORITIES),
  recruiterId: z.string().uuid().optional(),
  deadline: z.string().datetime().optional(),
  notes: z.string().optional(),
});

const createRequirementsSchema = z.object({
  clientId: z.string().uuid(),
  items: z.array(requirementItemSchema).min(1),
});

const patchRequirementSchema = z.object({
  deadline: z.string().datetime().optional(),
  notes: z.string().optional(),
});

const assignSchema = z.object({
  recruiterId: z.string().uuid().nullable(),
  note: z.string().optional(),
});

// GET /api/requirements?clientId=&status=&priority=&q= — filterable list
requirementRouter.get(
  "/",
  requireRole("owner", "recruiter"),
  asyncHandler(async (req: Request, res: Response) => {
    const where: Prisma.RequirementWhereInput = {};

    if (req.query.clientId) where.clientId = String(req.query.clientId);
    if (req.query.status) where.status = String(req.query.status) as any;
    if (req.query.priority) where.priority = String(req.query.priority) as any;
    if (req.query.q) {
      const q = String(req.query.q);
      where.OR = [
        { title: { contains: q, mode: "insensitive" } },
        { language: { contains: q, mode: "insensitive" } },
        { service: { contains: q, mode: "insensitive" } },
      ];
    }

    const requirements = await prisma.requirement.findMany({
      where,
      include: {
        client: { select: { name: true } },
        recruiter: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return res.json({ requirements });
  })
);

// POST /api/requirements — bulk-create requirement rows for a client
requirementRouter.post(
  "/",
  requireRole("owner", "recruiter"),
  asyncHandler(async (req: Request, res: Response) => {
    const { clientId, items } = createRequirementsSchema.parse(req.body);

    const client = await prisma.client.findUnique({ where: { id: clientId } });
    if (!client) throw new ApiError(404, "CLIENT_NOT_FOUND", "Client not found");

    const created = await prisma.$transaction(async (tx) => {
      const rows = [];
      for (const item of items) {
        const status = item.recruiterId ? "ACTIVE" : "UNASSIGNED";
        const requirement = await tx.requirement.create({
          data: {
            clientId,
            title: item.title,
            language: item.language,
            service: item.service,
            region: item.region,
            projectName: item.projectName,
            headcountNeeded: item.headcountNeeded,
            gap: item.headcountNeeded,
            priority: item.priority,
            status,
            recruiterId: item.recruiterId,
            deadline: item.deadline ? new Date(item.deadline) : undefined,
            notes: item.notes,
          },
        });

        if (item.recruiterId) {
          await tx.requirementAssignment.create({
            data: {
              requirementId: requirement.id,
              recruiterId: item.recruiterId,
              assignedById: req.user!.id,
              note: "Assigned on requirement creation",
            },
          });
        }

        rows.push(requirement);
      }
      return rows;
    });

    return res.status(201).json({ requirements: created });
  })
);

// PATCH /api/requirements/:id — deadline/notes edits only
requirementRouter.patch(
  "/:id",
  requireRole("owner", "recruiter"),
  asyncHandler(async (req: Request, res: Response) => {
    const patch = patchRequirementSchema.parse(req.body);

    const existing = await prisma.requirement.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new ApiError(404, "REQUIREMENT_NOT_FOUND", "Requirement not found");

    const updated = await prisma.requirement.update({
      where: { id: existing.id },
      data: {
        ...(patch.deadline !== undefined ? { deadline: new Date(patch.deadline) } : {}),
        ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
      },
    });
    return res.json({ requirement: updated });
  })
);

// POST /api/requirements/:id/assign — assign/unassign a recruiter, audit-logged
requirementRouter.post(
  "/:id/assign",
  requireRole("owner", "recruiter"),
  asyncHandler(async (req: Request, res: Response) => {
    const { recruiterId, note } = assignSchema.parse(req.body);

    const existing = await prisma.requirement.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new ApiError(404, "REQUIREMENT_NOT_FOUND", "Requirement not found");

    const newStatus = recruiterId
      ? existing.status === "UNASSIGNED"
        ? "ACTIVE"
        : existing.status
      : "UNASSIGNED";

    const [updated] = await prisma.$transaction([
      prisma.requirement.update({
        where: { id: existing.id },
        data: { recruiterId, status: newStatus },
      }),
      prisma.requirementAssignment.create({
        data: {
          requirementId: existing.id,
          recruiterId,
          assignedById: req.user!.id,
          note: note ?? null,
        },
      }),
    ]);

    return res.json({ requirement: updated });
  })
);
