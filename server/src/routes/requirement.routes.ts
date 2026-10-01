import { Router, Request, Response } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { authenticateJwt } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { asyncHandler } from "../lib/asyncHandler";
import { ApiError } from "../lib/apiError";
import { createNotification, formatTaskAssignmentBody, formatTaskAssignmentSlackCard, notifyRequirementStatusChange, requirementLinkForRole } from "../services/notification.service";

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

/** Contractors get the same requirement-level detail recruiters do (which
 * matters for the "same requirements page" parity ask) EXCEPT client
 * identity -- a contractor must never learn which client a piece of demand
 * belongs to. Strips the `client` key entirely rather than trying to
 * whitelist safe sub-fields, since a client's name is itself the thing being
 * withheld. Takes a plain role string rather than the full Express Request
 * so it's directly unit testable. */
export function redactClientIfContractor<T extends { client?: unknown }>(requesterRole: string, requirement: T): T {
  if (requesterRole.toLowerCase() !== "contractor") return requirement;
  const { client, ...rest } = requirement;
  return rest as T;
}

/** Requirement-scoped variant of the rule above, for the contractor Clients
 * page: a requirement ASSIGNED TO THIS CONTRACTOR is their own work and they
 * need to know who it's for, so it keeps `client`. Everything else -- another
 * person's requirement, unassigned demand -- still loses it, so a contractor
 * sees their clients and never the global client list.
 *
 * `clientId` goes with `client`, and that is not belt-and-braces: a
 * contractor who legitimately learns clientId -> name from their own row
 * could otherwise re-identify every other requirement for that client in the
 * same response. Default-deny -- anything not provably theirs is redacted,
 * including a requirement with no assignee at all. */
export function redactClientUnlessAssigned<
  T extends { client?: unknown; clientId?: unknown; recruiterId?: string | null },
>(requester: { role: string; id: string }, requirement: T): T {
  if (requester.role.toLowerCase() !== "contractor") return requirement;
  if (requirement.recruiterId && requirement.recruiterId === requester.id) return requirement;
  const { client, clientId, ...rest } = requirement;
  return rest as T;
}

// GET /api/requirements?clientId=&status=&priority=&q= — filterable list
requirementRouter.get(
  "/",
  requireRole("owner", "recruiter", "contractor"),
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
    return res.json({ requirements: requirements.map((r) => redactClientUnlessAssigned(req.user!, r)) });
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

    // Assignees can be contractors as well as recruiters, and the two land on
    // different Clients pages -- one lookup for the whole batch rather than
    // one per requirement, since a batch usually shares a handful of people.
    const assigneeIds = [...new Set(created.map((r) => r.recruiterId).filter((id): id is string => !!id))];
    const assigneeRoles = new Map(
      (await prisma.user.findMany({ where: { id: { in: assigneeIds } }, select: { id: true, role: true } })).map(
        (u) => [u.id, u.role as string]
      )
    );

    for (const requirement of created) {
      if (!requirement.recruiterId) continue;
      const link = requirementLinkForRole(assigneeRoles.get(requirement.recruiterId));
      await createNotification({
        recipientId: requirement.recruiterId,
        type: "TASK_ASSIGNMENT",
        title: `Assigned: ${requirement.title}`,
        body: formatTaskAssignmentBody(requirement, client.name),
        slackCard: formatTaskAssignmentSlackCard(requirement, link),
        link,
      }).catch((err) => console.error("[notifications] task assignment notify failed:", err));
    }

    return res.status(201).json({ requirements: created });
  })
);

// GET /api/requirements/:id — single requirement detail with assignments and client
requirementRouter.get(
  "/:id",
  requireRole("owner", "recruiter", "contractor"),
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
    return res.json({ requirement: redactClientUnlessAssigned(req.user!, requirement) });
  })
);

// GET /api/requirements/:id/history — assignment history audit trail
requirementRouter.get(
  "/:id/history",
  requireRole("owner", "recruiter", "contractor"),
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

    // Manual status edit -- notifyRequirementStatusChange no-ops internally
    // when status didn't actually change, so this is safe to fire unconditionally.
    notifyRequirementStatusChange(updated, existing.status).catch((err) =>
      console.error("[notifications] requirement status change notify failed:", err)
    );

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

    const existing = await prisma.requirement.findUnique({
      where: { id: req.params.id },
      include: { client: { select: { name: true } } },
    });
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

    // Unassign (recruiterId: null) fires nothing -- only a real assignment
    // is a "task assignment" someone needs to be told about.
    if (recruiterId) {
      // Only recruiterId/status change here -- title/language/service/etc.
      // (and the client relation) are `existing`'s, unchanged by this route.
      const assignee = await prisma.user.findUnique({ where: { id: recruiterId }, select: { role: true } });
      const link = requirementLinkForRole(assignee?.role);
      await createNotification({
        recipientId: recruiterId,
        type: "TASK_ASSIGNMENT",
        title: `Assigned: ${updated.title}`,
        body: formatTaskAssignmentBody(existing, existing.client.name),
        slackCard: formatTaskAssignmentSlackCard(existing, link),
        link,
      }).catch((err) => console.error("[notifications] task assignment notify failed:", err));
    }

    return res.json({ requirement: updated });
  })
);
