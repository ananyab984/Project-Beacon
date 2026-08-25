import { Router, Request, Response } from "express";
import { ClayService } from "../services/clay.service";

export const webhooksRouter = Router();

// POST /api/webhooks/clay/:token — Clay's outbound "Enrich person" result
// (Public with token & secret verification, same two-factor pattern as
// /api/unipile/webhook/:token — see UnipileService.handleWebhookEvent).
webhooksRouter.post("/clay/:token", async (req: Request, res: Response) => {
  try {
    const { token } = req.params;
    const secretHeader = req.headers["x-g3-webhook-secret"] as string | undefined;
    // TEMP DIAGNOSTIC -- remove once the secret-header mismatch is resolved.
    // Logs length + first/last 4 chars only, never the full secret.
    console.log(
      "[clay] received secret header:",
      secretHeader
        ? `len=${secretHeader.length} value=${secretHeader.slice(0, 4)}...${secretHeader.slice(-4)}`
        : "MISSING (no x-g3-webhook-secret header at all)",
      "| all header keys:", Object.keys(req.headers).join(", ")
    );
    const result = await ClayService.handleWebhookEvent(token, secretHeader, req.body);
    return res.status(200).json({ status: "ok", result });
  } catch (err: any) {
    console.error("[clay] webhook failed:", err?.message || err);
    const status = err.statusCode || 400;
    return res.status(status).json({ error: "WEBHOOK_FAILED", message: err.message });
  }
});
