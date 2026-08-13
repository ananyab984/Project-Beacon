import { Router, Request, Response } from "express";
import { UnipileService } from "../services/unipile.service";
import { authenticateJwt } from "../middleware/auth";

export const unipileRouter = Router();

// POST /api/unipile/connect — Mint hosted-auth link to connect LinkedIn/Email
unipileRouter.post("/connect", authenticateJwt, async (req: Request, res: Response) => {
  try {
    const { provider } = req.body || {};
    if (!provider) {
      return res.status(400).json({ error: "MISSING_PROVIDER", message: "Provider is required (LINKEDIN, GOOGLE, MAIL, OUTLOOK, EMAIL)" });
    }

    const userId = req.user!.id;
    const clientUrl = (req.headers.origin as string) || (req.headers.referer ? new URL(req.headers.referer as string).origin : undefined);
    const rolePath = req.user!.role === "owner" ? "/owner" : "/recruiter";
    const result = await UnipileService.mintHostedAuthLink(userId, provider, "create", clientUrl, rolePath);
    return res.json({ success: true, url: result.url, nonce: result.nonce });
  } catch (err: any) {
    const status = err.statusCode || 500;
    return res.status(status).json({ error: "CONNECT_FAILED", message: err.message || "Failed to mint hosted link" });
  }
});

// POST /api/unipile/reconnect — Mint reconnect hosted-auth link
unipileRouter.post("/reconnect", authenticateJwt, async (req: Request, res: Response) => {
  try {
    const { provider } = req.body || {};
    if (!provider) {
      return res.status(400).json({ error: "MISSING_PROVIDER", message: "Provider is required" });
    }

    const userId = req.user!.id;
    const result = await UnipileService.mintHostedAuthLink(userId, provider, "reconnect");
    return res.json({ success: true, url: result.url, nonce: result.nonce });
  } catch (err: any) {
    const status = err.statusCode || 500;
    return res.status(status).json({ error: "RECONNECT_FAILED", message: err.message || "Failed to mint reconnect link" });
  }
});

// GET /api/unipile/accounts — Get current recruiter's connected accounts
unipileRouter.get("/accounts", authenticateJwt, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const accounts = await UnipileService.getUserConnectedAccounts(userId);
    return res.json({ accounts });
  } catch (err: any) {
    return res.status(500).json({ error: "FETCH_ACCOUNTS_FAILED", message: err.message });
  }
});

// DELETE /api/unipile/accounts/:accountId — Disconnect account
unipileRouter.delete("/accounts/:accountId", authenticateJwt, async (req: Request, res: Response) => {
  try {
    const { accountId } = req.params;
    const userId = req.user!.id;
    await UnipileService.disconnectAccount(userId, accountId);
    return res.json({ success: true, message: "Account disconnected" });
  } catch (err: any) {
    return res.status(500).json({ error: "DISCONNECT_FAILED", message: err.message });
  }
});

// POST /api/unipile/webhook/:token — Webhook receiver (Public with token & secret verification)
unipileRouter.post("/webhook/:token", async (req: Request, res: Response) => {
  try {
    const { token } = req.params;
    const secretHeader = req.headers["x-g3-webhook-secret"] as string | undefined;
    const result = await UnipileService.handleWebhookEvent(token, secretHeader, req.body);
    return res.status(200).json({ status: "ok", result });
  } catch (err: any) {
    const status = err.statusCode || 400;
    return res.status(status).json({ error: "WEBHOOK_FAILED", message: err.message });
  }
});
