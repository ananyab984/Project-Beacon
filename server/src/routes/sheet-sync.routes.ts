import { Router, Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { authenticateJwt } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { asyncHandler } from "../lib/asyncHandler";

export const sheetSyncRouter = Router();

sheetSyncRouter.use(authenticateJwt);

const putSheetSyncSchema = z.object({
  sheetUrl: z.string().url(),
});

// GET /api/sheet-sync — current user's Google Sheet sync config
sheetSyncRouter.get(
  "/",
  requireRole("owner", "recruiter"),
  asyncHandler(async (req: Request, res: Response) => {
    const config = await prisma.sheetSyncConfig.findUnique({
      where: { ownerUserId: req.user!.id },
    });
    return res.json(config ?? { sheetUrl: null, lastSyncedAt: null });
  })
);

// PUT /api/sheet-sync — upsert the sheet URL for the current user
sheetSyncRouter.put(
  "/",
  requireRole("owner", "recruiter"),
  asyncHandler(async (req: Request, res: Response) => {
    const { sheetUrl } = putSheetSyncSchema.parse(req.body);

    const config = await prisma.sheetSyncConfig.upsert({
      where: { ownerUserId: req.user!.id },
      update: { sheetUrl },
      create: { ownerUserId: req.user!.id, sheetUrl },
    });
    return res.json(config);
  })
);

// POST /api/sheet-sync/sync — no Google Sheets API integration is wired up yet
// (no OAuth/credentials configured anywhere in this codebase). Report honestly
// instead of fabricating a successful sync.
sheetSyncRouter.post(
  "/sync",
  requireRole("owner", "recruiter"),
  asyncHandler(async (_req: Request, res: Response) => {
    return res.status(200).json({ synced: false, reason: "Google Sheets sync is not configured yet" });
  })
);
