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

const createDemandSchema = z.object({
  clientName: z.string().min(1).max(160),
  language: z.string().min(1),
  services: z.array(serviceSchema).min(1),
  priority: z.enum(PRIORITIES),
  deadline: z.string().datetime().optional(),
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
