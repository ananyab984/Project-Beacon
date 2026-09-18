import { Router, Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { authenticateJwt } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { asyncHandler } from "../lib/asyncHandler";
import { ApiError } from "../lib/apiError";
import { getSystemSetting, setSystemSetting } from "../services/system-settings.service";
import { UnipileService } from "../services/unipile.service";

export const systemSettingsRouter = Router();

systemSettingsRouter.use(authenticateJwt);
systemSettingsRouter.use(requireRole("owner"));

const EMAIL_PROVIDERS = ["EMAIL", "GOOGLE", "MAIL", "OUTLOOK"];

// GET /api/system-settings/notifications — owner-only status view. Never
// echoes the Slack token back, only whether one is set. The Slack bot token
// itself is a secret (SLACK_BOT_TOKEN, set in the deployment environment),
// not owner-editable app config -- unlike the Unipile notification-mailbox
// setting below, there's no PATCH route for it.
systemSettingsRouter.get(
  "/notifications",
  asyncHandler(async (_req: Request, res: Response) => {
    const notificationAccountId = await getSystemSetting("UNIPILE_SYSTEM_ACCOUNT_ID");

    const notificationAccount = notificationAccountId
      ? await prisma.connectedAccount.findFirst({
          where: { unipileAccountId: notificationAccountId },
          select: { unipileAccountId: true, accountName: true, provider: true, status: true },
        })
      : null;

    return res.json({
      slackBotTokenConfigured: !!process.env.SLACK_BOT_TOKEN,
      notificationAccount,
    });
  })
);

// POST /api/system-settings/notification-email-account — designate an
// already-connected (to this owner's own user) Unipile email account as the
// system notification mailbox. The owner connects it first via the existing
// Unipile hosted-auth popup (api.connectAccount("EMAIL")), then this just
// records which connected account to use.
systemSettingsRouter.post(
  "/notification-email-account",
  asyncHandler(async (req: Request, res: Response) => {
    const { unipileAccountId } = z.object({ unipileAccountId: z.string().min(1) }).parse(req.body);

    const account = await prisma.connectedAccount.findFirst({
      where: { userId: req.user!.id, unipileAccountId, status: { not: "DISCONNECTED" } },
    });
    if (!account) throw new ApiError(404, "ACCOUNT_NOT_FOUND", "Connect this email account first, then designate it here");
    if (!EMAIL_PROVIDERS.some((p) => account.provider.toUpperCase().includes(p))) {
      throw new ApiError(400, "NOT_AN_EMAIL_ACCOUNT", "The notification mailbox must be an Email-type account");
    }

    await setSystemSetting("UNIPILE_SYSTEM_ACCOUNT_ID", unipileAccountId, "Unipile connected-account id used for system notification emails");
    return res.json({ success: true });
  })
);

// DELETE /api/system-settings/notification-email-account — fully removes the
// designated mailbox: disconnects the underlying Unipile account and clears
// the designation, so the owner doesn't need two separate actions.
systemSettingsRouter.delete(
  "/notification-email-account",
  asyncHandler(async (_req: Request, res: Response) => {
    const unipileAccountId = await getSystemSetting("UNIPILE_SYSTEM_ACCOUNT_ID");
    if (unipileAccountId) {
      const account = await prisma.connectedAccount.findFirst({ where: { unipileAccountId } });
      if (account) {
        await UnipileService.disconnectAccount(account.userId, unipileAccountId).catch((err) =>
          console.error("[system-settings] failed to disconnect notification mailbox:", err)
        );
      }
    }
    await setSystemSetting("UNIPILE_SYSTEM_ACCOUNT_ID", null);
    return res.json({ success: true });
  })
);
