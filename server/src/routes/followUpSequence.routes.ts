import { Router, Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { authenticateJwt } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { asyncHandler } from "../lib/asyncHandler";
import { ApiError } from "../lib/apiError";
import { getDraftingOrchestrator } from "../drafting/instance";
import { buildDraftLeadPayload } from "../lib/draftLeadPayload";
import { UnipileService } from "../services/unipile.service";
import { createNotification } from "../services/notification.service";

export const followUpSequenceRouter = Router();
followUpSequenceRouter.use(authenticateJwt);

// GET /api/follow-up-sequences — list all sequences for current user (owner sees all)
followUpSequenceRouter.get(
  "/",
  requireRole("owner", "recruiter"),
  asyncHandler(async (req: Request, res: Response) => {
    const role = req.user!.role.toLowerCase();
    const isOwner = role === "owner";

    const where = isOwner
      ? {}
      : {
          OR: [{ ownerId: req.user!.id }, { isGlobal: true }],
        };

    const sequences = await prisma.followUpSequence.findMany({
      where,
      include: {
        steps: { orderBy: { stepOrder: "asc" } },
        owner: { select: { id: true, name: true } },
        _count: { select: { steps: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return res.json({ sequences });
  })
);

// GET /api/follow-up-sequences/:id — single sequence with steps
followUpSequenceRouter.get(
  "/:id",
  requireRole("owner", "recruiter"),
  asyncHandler(async (req: Request, res: Response) => {
    const sequence = await prisma.followUpSequence.findUnique({
      where: { id: req.params.id },
      include: {
        steps: { orderBy: { stepOrder: "asc" } },
        owner: { select: { id: true, name: true } },
      },
    });

    if (!sequence) throw new ApiError(404, "SEQUENCE_NOT_FOUND", "Follow-up sequence not found");

    const role = req.user!.role.toLowerCase();
    if (!sequence.isGlobal && sequence.ownerId !== req.user!.id && role !== "owner") {
      throw new ApiError(403, "FORBIDDEN", "You do not have permission to view this sequence");
    }

    return res.json({ sequence });
  })
);

// POST /api/follow-up-sequences — create new sequence
followUpSequenceRouter.post(
  "/",
  requireRole("owner", "recruiter"),
  asyncHandler(async (req: Request, res: Response) => {
    const schema = z.object({
      name: z.string().min(1).max(120),
      description: z.string().max(500).optional(),
      isGlobal: z.boolean().optional(),
      steps: z.array(
        z.object({
          stepOrder: z.number().int().positive(),
          triggerType: z.enum(["TIME_BASED", "STAGE_CHANGE", "REPLY_RECEIVED", "MANUAL"]).default("TIME_BASED"),
          triggerConfig: z.record(z.string(), z.any()).optional(),
          channel: z.enum(["EMAIL", "LINKEDIN"]),
          subjectTemplate: z.string().max(200).optional(),
          bodyTemplate: z.string().min(1).max(5000),
          useAiDraft: z.boolean().default(true),
          isActive: z.boolean().default(true),
        })
      ).min(1).max(10),
    });

    const { name, description, isGlobal, steps } = schema.parse(req.body);

    const sequence = await prisma.followUpSequence.create({
      data: {
        name,
        description,
        isGlobal: isGlobal ?? false,
        ownerId: req.user!.id,
        steps: {
          create: steps.map((s) => ({
            stepOrder: s.stepOrder,
            triggerType: s.triggerType,
            triggerConfig: s.triggerConfig ?? {},
            channel: s.channel,
            subjectTemplate: s.subjectTemplate,
            bodyTemplate: s.bodyTemplate,
            useAiDraft: s.useAiDraft,
            isActive: s.isActive,
          })),
        },
      },
      include: { steps: { orderBy: { stepOrder: "asc" } } },
    });

    return res.status(201).json({ sequence });
  })
);

// PATCH /api/follow-up-sequences/:id — update sequence
followUpSequenceRouter.patch(
  "/:id",
  requireRole("owner", "recruiter"),
  asyncHandler(async (req: Request, res: Response) => {
    const existing = await prisma.followUpSequence.findUnique({
      where: { id: req.params.id },
      include: { steps: true },
    });

    if (!existing) throw new ApiError(404, "SEQUENCE_NOT_FOUND", "Follow-up sequence not found");

    const role = req.user!.role.toLowerCase();
    if (existing.ownerId !== req.user!.id && role !== "owner") {
      throw new ApiError(403, "FORBIDDEN", "You can only edit your own sequences");
    }

    const schema = z.object({
      name: z.string().min(1).max(120).optional(),
      description: z.string().max(500).optional().nullable(),
      status: z.enum(["ACTIVE", "PAUSED", "COMPLETED", "ARCHIVED"]).optional(),
      isGlobal: z.boolean().optional(),
      steps: z.array(
        z.object({
          id: z.string().uuid().optional(),
          stepOrder: z.number().int().positive(),
          triggerType: z.enum(["TIME_BASED", "STAGE_CHANGE", "REPLY_RECEIVED", "MANUAL"]).optional(),
          triggerConfig: z.record(z.string(), z.any()).optional().nullable(),
          channel: z.enum(["EMAIL", "LINKEDIN"]).optional(),
          subjectTemplate: z.string().max(200).optional().nullable(),
          bodyTemplate: z.string().min(1).max(5000).optional(),
          useAiDraft: z.boolean().optional(),
          isActive: z.boolean().optional(),
        })
      ).optional(),
    });

    const { steps, ...data } = schema.parse(req.body);

    const updated = await prisma.$transaction(async (tx) => {
      const seq = await tx.followUpSequence.update({
        where: { id: req.params.id },
        data,
      });

      if (steps) {
        const existingStepIds = new Set(existing.steps.map((s) => s.id));
        const incomingStepIds = new Set(steps.filter((s) => s.id).map((s) => s.id!));

        // Delete removed steps
        for (const id of existingStepIds) {
          if (!incomingStepIds.has(id)) {
            await tx.followUpStep.delete({ where: { id } });
          }
        }

        // Update or create steps
        for (const step of steps) {
          if (step.id && existingStepIds.has(step.id)) {
            await tx.followUpStep.update({
              where: { id: step.id },
              data: {
                stepOrder: step.stepOrder,
                triggerType: step.triggerType,
                triggerConfig: step.triggerConfig ?? {},
                channel: step.channel,
                subjectTemplate: step.subjectTemplate,
                bodyTemplate: step.bodyTemplate,
                useAiDraft: step.useAiDraft,
                isActive: step.isActive,
              },
            });
          } else {
            await tx.followUpStep.create({
              data: {
                sequenceId: req.params.id,
                stepOrder: step.stepOrder,
                triggerType: step.triggerType ?? "TIME_BASED",
                triggerConfig: step.triggerConfig ?? {},
                channel: step.channel!,
                subjectTemplate: step.subjectTemplate,
                bodyTemplate: step.bodyTemplate!,
                useAiDraft: step.useAiDraft ?? true,
                isActive: step.isActive ?? true,
              },
            });
          }
        }
      }

      return tx.followUpSequence.findUnique({
        where: { id: req.params.id },
        include: { steps: { orderBy: { stepOrder: "asc" } } },
      });
    });

    return res.json({ sequence: updated });
  })
);

// DELETE /api/follow-up-sequences/:id — archive sequence (soft delete via status)
followUpSequenceRouter.delete(
  "/:id",
  requireRole("owner", "recruiter"),
  asyncHandler(async (req: Request, res: Response) => {
    const existing = await prisma.followUpSequence.findUnique({
      where: { id: req.params.id },
    });

    if (!existing) throw new ApiError(404, "SEQUENCE_NOT_FOUND", "Follow-up sequence not found");

    const role = req.user!.role.toLowerCase();
    if (existing.ownerId !== req.user!.id && role !== "owner") {
      throw new ApiError(403, "FORBIDDEN", "You can only delete your own sequences");
    }

    await prisma.followUpSequence.update({
      where: { id: req.params.id },
      data: { status: "ARCHIVED" },
    });

    return res.json({ success: true });
  })
);

// POST /api/follow-up-sequences/:id/enroll — enroll a lead in a sequence
followUpSequenceRouter.post(
  "/:id/enroll",
  requireRole("owner", "recruiter"),
  asyncHandler(async (req: Request, res: Response) => {
    const schema = z.object({
      leadId: z.string().uuid(),
      recruiterId: z.string().uuid().optional(), // defaults to current user
    });

    const { leadId, recruiterId } = schema.parse(req.body);
    const effectiveRecruiterId = recruiterId ?? req.user!.id;

    const sequence = await prisma.followUpSequence.findUnique({
      where: { id: req.params.id },
      include: { steps: { where: { isActive: true }, orderBy: { stepOrder: "asc" } } },
    });

    if (!sequence) throw new ApiError(404, "SEQUENCE_NOT_FOUND", "Follow-up sequence not found");
    if (sequence.status !== "ACTIVE") throw new ApiError(400, "SEQUENCE_INACTIVE", "Sequence is not active");

    const lead = await prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead) throw new ApiError(404, "LEAD_NOT_FOUND", "Lead not found");

    // Check ownership for contractors
    if (req.user!.role.toLowerCase() === "contractor" && lead.createdByContractorId !== req.user!.id) {
      throw new ApiError(403, "FORBIDDEN", "Contractors can only enroll their own leads");
    }

    // Create executions for each step
    const executions = await prisma.$transaction(
      sequence.steps.map((step, index) => {
        let scheduledAt: Date | undefined;
        if (step.triggerType === "TIME_BASED") {
          const daysAfter = (step.triggerConfig as any)?.daysAfter ?? (index === 0 ? 0 : 3);
          scheduledAt = new Date(Date.now() + daysAfter * 86_400_000);
        }
        return prisma.followUpExecution.create({
          data: {
            stepId: step.id,
            leadId,
            recruiterId: effectiveRecruiterId,
            status: "PENDING",
            scheduledAt,
          },
        });
      })
    );

    return res.status(201).json({ executions });
  })
);

// GET /api/follow-up-sequences/:id/executions — get executions for a sequence
followUpSequenceRouter.get(
  "/:id/executions",
  requireRole("owner", "recruiter"),
  asyncHandler(async (req: Request, res: Response) => {
    const leadId = req.query.leadId as string | undefined;
    const status = req.query.status as string | undefined;

    const where: any = { step: { sequenceId: req.params.id } };
    if (leadId) where.leadId = leadId;
    if (status) where.status = status;

    const executions = await prisma.followUpExecution.findMany({
      where,
      include: {
        step: true,
        lead: { select: { id: true, fullName: true, displayName: true, email: true, profileLink: true, stage: true } },
        recruiter: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    return res.json({ executions });
  })
);

// POST /api/follow-up-executions/:id/retry — retry a failed execution
followUpSequenceRouter.post(
  "/executions/:id/retry",
  requireRole("owner", "recruiter"),
  asyncHandler(async (req: Request, res: Response) => {
    const execution = await prisma.followUpExecution.findUnique({
      where: { id: req.params.id },
      include: { step: { include: { sequence: true } }, lead: true },
    });

    if (!execution) throw new ApiError(404, "EXECUTION_NOT_FOUND", "Execution not found");

    const role = req.user!.role.toLowerCase();
    if (execution.recruiterId !== req.user!.id && role !== "owner") {
      throw new ApiError(403, "FORBIDDEN", "You can only retry your own executions");
    }

    await prisma.followUpExecution.update({
      where: { id: req.params.id },
      data: { status: "PENDING", error: null, scheduledAt: new Date() },
    });

    return res.json({ success: true });
  })
);

// POST /api/follow-up-executions/:id/skip — skip an execution
followUpSequenceRouter.post(
  "/executions/:id/skip",
  requireRole("owner", "recruiter"),
  asyncHandler(async (req: Request, res: Response) => {
    const execution = await prisma.followUpExecution.findUnique({
      where: { id: req.params.id },
    });

    if (!execution) throw new ApiError(404, "EXECUTION_NOT_FOUND", "Execution not found");

    const role = req.user!.role.toLowerCase();
    if (execution.recruiterId !== req.user!.id && role !== "owner") {
      throw new ApiError(403, "FORBIDDEN", "You can only skip your own executions");
    }

    await prisma.followUpExecution.update({
      where: { id: req.params.id },
      data: { status: "SKIPPED" },
    });

    return res.json({ success: true });
  })
);