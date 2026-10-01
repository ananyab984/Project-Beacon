import { Router, Request, Response } from "express";
import { z } from "zod";
import { authenticateJwt } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { asyncHandler } from "../lib/asyncHandler";
import { ApiError } from "../lib/apiError";
import { prisma } from "../prisma";
import { config } from "../config";

export const replyCategoriesRouter = Router();

replyCategoriesRouter.use(authenticateJwt);

const createReplyCategorySchema = z.object({
  groupName: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
});

const updateReplyCategorySchema = z
  .object({
    groupName: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    description: z.string().min(1).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, {
    message: "Provide at least one field to update",
  });

// GET /api/reply-categories — list all active categories, plus the single
// feature-wide kill switch (see config.ts's replyClassificationEnabled).
// Every client surface that needs to know whether classification is on --
// the owner nav item, the category dashboard, and the badge/dropdown on
// both the LinkedIn and Email views -- reads `featureEnabled` off THIS
// response rather than each carrying its own flag, so there's exactly one
// place the client and server can ever drift on this.
replyCategoriesRouter.get(
  "/",
  asyncHandler(async (_req: Request, res: Response) => {
    const replyCategories = await prisma.replyCategory.findMany({
      where: { isActive: true },
      orderBy: [{ groupName: "asc" }, { name: "asc" }],
    });
    return res.json({ replyCategories, featureEnabled: config.replyClassificationEnabled });
  })
);

// GET /api/reply-categories/:id — single category.
replyCategoriesRouter.get(
  "/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const replyCategory = await prisma.replyCategory.findUnique({ where: { id: req.params.id } });
    if (!replyCategory) throw new ApiError(404, "REPLY_CATEGORY_NOT_FOUND", "Reply category not found");
    return res.json({ replyCategory });
  })
);

// POST /api/reply-categories — create a category. Owner only.
replyCategoriesRouter.post(
  "/",
  requireRole("owner"),
  asyncHandler(async (req: Request, res: Response) => {
    const { groupName, name, description } = createReplyCategorySchema.parse(req.body);
    const replyCategory = await prisma.replyCategory.create({
      data: { groupName, name, description, isActive: true },
    });
    return res.status(201).json({ replyCategory });
  })
);

// PATCH /api/reply-categories/:id — update provided fields only. Owner only.
replyCategoriesRouter.patch(
  "/:id",
  requireRole("owner"),
  asyncHandler(async (req: Request, res: Response) => {
    const patch = updateReplyCategorySchema.parse(req.body);

    const existing = await prisma.replyCategory.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new ApiError(404, "REPLY_CATEGORY_NOT_FOUND", "Reply category not found");

    const replyCategory = await prisma.replyCategory.update({ where: { id: req.params.id }, data: patch });
    return res.json({ replyCategory });
  })
);

// DELETE /api/reply-categories/:id — hard delete. Owner only. Lead rows
// referencing this category fall back to "Unclassified" via onDelete:
// SetNull (see schema.prisma), so this never errors on existing leads.
replyCategoriesRouter.delete(
  "/:id",
  requireRole("owner"),
  asyncHandler(async (req: Request, res: Response) => {
    const existing = await prisma.replyCategory.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new ApiError(404, "REPLY_CATEGORY_NOT_FOUND", "Reply category not found");

    await prisma.replyCategory.delete({ where: { id: req.params.id } });
    return res.json({ success: true });
  })
);
