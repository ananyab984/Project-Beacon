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

// GET /api/requirements/:id — single requirement detail with assignments and client
requirementRouter.get(
  "/:id",
  requireRole("owner", "recruiter"),
  asyncHandler(async (req: Request, res: Response) => {
    const requirement = await prisma.requirement.findUnique({
      where: { id: req.params.id },
      include: {
        client: true,
        recruiter: { select: { id: true, name: true, email: true } },
        assignmentHistory: {
          include: {
            recruiter: { select: { name: true } },
            assignedBy: { select: { name: true } },
          },
          orderBy: { assignedAt: "desc" },
        },
      },
    });
    if (!requirement) throw new ApiError(404, "REQUIREMENT_NOT_FOUND", "Requirement not found");
    return res.json({ requirement });
  })
);

// GET /api/requirements/:id/history — assignment history audit trail
requirementRouter.get(
  "/:id/history",
  requireRole("owner", "recruiter"),
  asyncHandler(async (req: Request, res: Response) => {
    const assignments = await prisma.requirementAssignment.findMany({
      where: { requirementId: req.params.id },
      include: {
        recruiter: { select: { id: true, name: true, email: true } },
        assignedBy: { select: { id: true, name: true, email: true } },
      },
      orderBy: { assignedAt: "desc" },
    });
    return res.json({ assignments });
  })
);

// PATCH /api/requirements/:id — full requirement fields edit
requirementRouter.patch(
  "/:id",
  requireRole("owner", "recruiter"),
  asyncHandler(async (req: Request, res: Response) => {
    const schema = z.object({
      title: z.string().optional(),
      language: z.string().optional(),
      service: z.string().optional(),
      region: z.string().optional().nullable(),
      projectName: z.string().optional().nullable(),
      headcountNeeded: z.number().int().min(0).optional(),
      priority: z.enum(PRIORITIES).optional(),
      status: z.enum(["UNASSIGNED", "ACTIVE", "PAUSED", "FULFILLED", "CANCELLED"]).optional(),
      deadline: z.string().datetime().optional().nullable(),
      notes: z.string().optional().nullable(),
    });
    const patch = schema.parse(req.body);

    const existing = await prisma.requirement.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new ApiError(404, "REQUIREMENT_NOT_FOUND", "Requirement not found");

    const updatedHeadcount = patch.headcountNeeded !== undefined ? patch.headcountNeeded : existing.headcountNeeded;
    const updatedGap = Math.max(0, updatedHeadcount - existing.filled);

    const updated = await prisma.requirement.update({
      where: { id: existing.id },
      data: {
        ...(patch.title ? { title: patch.title } : {}),
        ...(patch.language ? { language: patch.language } : {}),
        ...(patch.service ? { service: patch.service } : {}),
        ...(patch.region !== undefined ? { region: patch.region } : {}),
        ...(patch.projectName !== undefined ? { projectName: patch.projectName } : {}),
        ...(patch.headcountNeeded !== undefined ? { headcountNeeded: updatedHeadcount, gap: updatedGap } : {}),
        ...(patch.priority ? { priority: patch.priority } : {}),
        ...(patch.status ? { status: patch.status as any } : {}),
        ...(patch.deadline !== undefined ? { deadline: patch.deadline ? new Date(patch.deadline) : null } : {}),
        ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
      },
      include: {
        client: { select: { name: true } },
        recruiter: { select: { name: true } },
      },
    });
    return res.json({ requirement: updated });
  })
);

// DELETE /api/requirements/:id — delete requirement (owner only)
requirementRouter.delete(
  "/:id",
  requireRole("owner"),
  asyncHandler(async (req: Request, res: Response) => {
    const existing = await prisma.requirement.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new ApiError(404, "REQUIREMENT_NOT_FOUND", "Requirement not found");

    await prisma.requirement.delete({ where: { id: req.params.id } });
    return res.json({ success: true, message: "Requirement deleted successfully" });
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
