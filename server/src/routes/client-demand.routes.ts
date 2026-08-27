import { Router, Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { authenticateJwt } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { asyncHandler } from "../lib/asyncHandler";

export const clientDemandRouter = Router();

clientDemandRouter.use(authenticateJwt);

const PRIORITIES = ["STANDARD", "HIGH", "CRITICAL"] as const;

const serviceSchema = z.object({
  service: z.string().min(1),
  needed: z.number().int().min(0),
});

// z.string().datetime() requires a full "2026-01-01T00:00:00Z"-style
// timestamp -- rejects the plain "2026-01-01" an <input type="date">
// actually sends, which is what every client of this route uses. Accept
// anything Date can parse, matching what the handlers already do with it
// (new Date(parsed.deadline)) instead of requiring a format nothing sends.
const flexibleDate = z.string().refine((v) => !isNaN(new Date(v).getTime()), { message: "Invalid date" });

const createDemandSchema = z.object({
  clientName: z.string().min(1).max(160),
  projectName: z.string().optional(),
  language: z.string().min(1),
  services: z.array(serviceSchema).min(1),
  priority: z.enum(PRIORITIES),
  deadline: flexibleDate.optional(),
  contactName: z.string().optional(),
  contactEmail: z.string().email().optional(),
  notes: z.string().optional(),
});

// GET /api/client-demands — read-only aggregate view (owner, recruiter, contractor)
clientDemandRouter.get(
  "/",
  requireRole("owner", "recruiter", "contractor"),
  asyncHandler(async (req: Request, res: Response) => {
    const clientDemands = await prisma.clientDemand.findMany({
      include: {
        serviceBreakdown: true,
        client: { select: { name: true } },
      },
      orderBy: { submittedAt: "desc" },
    });
    return res.json({ clientDemands });
  })
);

// POST /api/client-demands — one intake submission creates BOTH the ClientDemand
// aggregate AND one Requirement per service, in the same transaction. This is the
// fix for the two-model-divergence bug: the old mock only ever updated
// ClientDemand's counters and never wrote a matching Requirement row.
clientDemandRouter.post(
  "/",
  requireRole("owner", "recruiter"),
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = createDemandSchema.parse(req.body);
    const headcountNeeded = parsed.services.reduce((sum, s) => sum + s.needed, 0);

    const result = await prisma.$transaction(async (tx) => {
      let client = await tx.client.findFirst({
        where: { name: { equals: parsed.clientName, mode: "insensitive" } },
      });
      if (!client) {
        client = await tx.client.create({
          data: {
            name: parsed.clientName,
            contactName: parsed.contactName,
            contactEmail: parsed.contactEmail,
          },
        });
      }

      const clientDemand = await tx.clientDemand.create({
        data: {
          clientId: client.id,
          language: parsed.language,
          projectName: parsed.projectName,
          headcountNeeded,
          filled: 0,
          gap: headcountNeeded,
          priority: parsed.priority,
          deadline: parsed.deadline ? new Date(parsed.deadline) : undefined,
          contactName: parsed.contactName,
          contactEmail: parsed.contactEmail,
          notes: parsed.notes,
          serviceBreakdown: {
            create: parsed.services.map((s) => ({
              service: s.service,
              needed: s.needed,
              filled: 0,
              gap: s.needed,
            })),
          },
        },
        include: { serviceBreakdown: true },
      });

      const requirements = [];
      for (const s of parsed.services) {
        const requirement = await tx.requirement.create({
          data: {
            clientId: client.id,
            title: `${parsed.clientName} — ${parsed.language} ${s.service}`,
            language: parsed.language,
            service: s.service,
            headcountNeeded: s.needed,
            gap: s.needed,
            priority: parsed.priority,
            status: "UNASSIGNED",
            deadline: parsed.deadline ? new Date(parsed.deadline) : undefined,
            notes: parsed.notes,
          },
        });
        requirements.push(requirement);
      }

      return { clientDemand, requirements };
    });

    return res.status(201).json(result);
  })
);

// GET /api/client-demands/:id — single demand detail
clientDemandRouter.get(
  "/:id",
  requireRole("owner", "recruiter", "contractor"),
  asyncHandler(async (req: Request, res: Response) => {
    const demand = await prisma.clientDemand.findUnique({
      where: { id: req.params.id },
      include: {
        client: true,
        serviceBreakdown: true,
      },
    });
    if (!demand) {
      return res.status(404).json({ error: "DEMAND_NOT_FOUND", message: "Client demand not found" });
    }
    return res.json({ clientDemand: demand });
  })
);

// PATCH /api/client-demands/:id — update priority, deadline, notes, contact, headcount
clientDemandRouter.patch(
  "/:id",
  requireRole("owner", "recruiter"),
  asyncHandler(async (req: Request, res: Response) => {
    const patchSchema = z.object({
      priority: z.enum(PRIORITIES).optional(),
      deadline: flexibleDate.optional().nullable(),
      contactName: z.string().optional().nullable(),
      contactEmail: z.string().email().optional().nullable(),
      notes: z.string().optional().nullable(),
      headcountNeeded: z.number().int().min(0).optional(),
    });
    const patch = patchSchema.parse(req.body);

    const existing = await prisma.clientDemand.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      return res.status(404).json({ error: "DEMAND_NOT_FOUND", message: "Client demand not found" });
    }

    const updatedHeadcount = patch.headcountNeeded !== undefined ? patch.headcountNeeded : existing.headcountNeeded;
    const updatedGap = Math.max(0, updatedHeadcount - existing.filled);

    const updated = await prisma.clientDemand.update({
      where: { id: req.params.id },
      data: {
        ...(patch.priority ? { priority: patch.priority } : {}),
        ...(patch.deadline !== undefined ? { deadline: patch.deadline ? new Date(patch.deadline) : null } : {}),
        ...(patch.contactName !== undefined ? { contactName: patch.contactName } : {}),
        ...(patch.contactEmail !== undefined ? { contactEmail: patch.contactEmail } : {}),
        ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
        ...(patch.headcountNeeded !== undefined ? { headcountNeeded: updatedHeadcount, gap: updatedGap } : {}),
      },
      include: { serviceBreakdown: true, client: true },
    });

    return res.json({ clientDemand: updated });
  })
);

// DELETE /api/client-demands/:id — delete demand and cascade service breakdown
clientDemandRouter.delete(
  "/:id",
  requireRole("owner"),
  asyncHandler(async (req: Request, res: Response) => {
    const existing = await prisma.clientDemand.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      return res.status(404).json({ error: "DEMAND_NOT_FOUND", message: "Client demand not found" });
    }

    await prisma.clientDemand.delete({ where: { id: req.params.id } });
    return res.json({ success: true, message: "Client demand deleted successfully" });
  })
);
