import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { config } from "./config";
import { authRouter } from "./routes/auth.routes";
import { leadRouter } from "./routes/lead.routes";
import { unipileRouter } from "./routes/unipile.routes";
import { outreachRouter } from "./routes/outreach.routes";
import { userRouter } from "./routes/user.routes";
import { clientRouter } from "./routes/client.routes";
import { requirementRouter } from "./routes/requirement.routes";
import { clientDemandRouter } from "./routes/client-demand.routes";
import { sheetSyncRouter } from "./routes/sheet-sync.routes";
import { emailQueueRouter } from "./routes/email-queue.routes";
import { conversationRouter } from "./routes/conversation.routes";
import { escalationRouter } from "./routes/escalation.routes";
import { evaluationRouter } from "./routes/evaluation.routes";
import { onboardingShortLinkRouter } from "./routes/onboardingShortLink.routes";
import { reportsRouter } from "./routes/reports.routes";
import { enrichmentEvaluationRouter } from "./routes/enrichmentEvaluation.routes";
import { faqRouter } from "./routes/faq.routes";
import { healthHandler } from "./lib/health";
import { replyCategoriesRouter } from "./routes/replyCategories.routes";
import { notificationRouter } from "./routes/notification.routes";
import { systemSettingsRouter } from "./routes/system-settings.routes";
import { notFoundHandler, errorHandler } from "./middleware/errorHandler";
import { startBackgroundJobs, stopBackgroundJobs } from "./jobs";
import {
  requeueInFlightEnrichments,
  requeueOrphanedEnrichments,
  stopClaimingEnrichments,
  waitForActiveEnrichments,
} from "./jobs/enrichment.job";
import { prisma } from "./prisma";
import { runShutdown } from "./lib/gracefulShutdown";

const app = express();
let keepaliveTimer: NodeJS.Timeout | null = null;
const allowedOrigins = new Set(
  [
    config.clientUrl,
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:8002",
    "http://127.0.0.1:8002",
  ]
    .map((value) => {
      try {
        return new URL(value).origin;
      } catch {
        return value;
      }
    })
    .filter(Boolean)
);

app.use(helmet());
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }

      if (allowedOrigins.has(origin) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`CORS blocked for origin ${origin}`));
    },
    credentials: true,
  })
);
// Matches Express's own default (100kb) -- made explicit so it reads as a
// deliberate choice, not an oversight, and so raising it later is a
// one-line change.
// Bulk lead uploads carry up to config.bulkUploadMaxRows rows (~1-2 KB each),
// which the 100kb default rejected with a 413 at ~300-500 rows. Only these
// routes get the bigger limit; the general parser below skips a body that's
// already parsed (body-parser's req._body check).
app.use(["/api/leads/bulk", "/api/leads/check-bulk-duplicates", "/api/leads/import-from-sheet"], express.json({ limit: "5mb" }));
app.use(express.json({ limit: "100kb" }));
app.use(cookieParser());

// Health Check
app.get("/health", healthHandler);

// API Routes
app.use("/api/auth", authRouter);
app.use("/api/leads", leadRouter);
app.use("/api/unipile", unipileRouter);
app.use("/api/outreach", outreachRouter);
app.use("/api/users", userRouter);
app.use("/api/clients", clientRouter);
app.use("/api/requirements", requirementRouter);
app.use("/api/client-demands", clientDemandRouter);
app.use("/api/sheet-sync", sheetSyncRouter);
app.use("/api/email-queue", emailQueueRouter);
app.use("/api/conversations", conversationRouter);
app.use("/api/escalations", escalationRouter);
app.use("/api/reports", reportsRouter);
app.use("/api/enrichment-evaluation", enrichmentEvaluationRouter);
app.use("/api/faq", faqRouter);
app.use("/api/reply-categories", replyCategoriesRouter);
app.use("/api/notifications", notificationRouter);
app.use("/api/system-settings", systemSettingsRouter);
app.use("/api", evaluationRouter);
// Deliberately NOT under /api: this is a public link a candidate opens in a
// browser, and every character counts against the LinkedIn note cap.
app.use("/g", onboardingShortLinkRouter);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;

function startKeepalivePing() {
  if (!config.keepaliveEnabled) return;

  const targetUrl = config.keepaliveUrl.replace(/\/+$/, "");
  const ping = async () => {
    try {
      const res = await fetch(`${targetUrl}/health`, {
        method: "GET",
        headers: { "User-Agent": "ProjectBeacon-Keepalive/1.0" },
      });
      if (!res.ok) {
        console.warn(`[keepalive] ping to ${targetUrl}/health returned ${res.status}`);
      }
    } catch (err) {
      console.warn(`[keepalive] ping to ${targetUrl}/health failed:`, err);
    }
  };

  void ping();
  keepaliveTimer = setInterval(ping, Math.max(60_000, config.keepaliveIntervalMs));
}

// Keep the local dev experience the same, but avoid starting a long-lived
// listener or in-process cron jobs inside Vercel's serverless runtime.
if (process.env.VERCEL !== "1") {
  const bootTime = new Date();
  const server = app.listen(config.port, () => {
    console.log(`====================================================`);
    console.log(`Global3 Auth Server running on http://localhost:${config.port}`);
    console.log(`Client URL: ${config.clientUrl}`);
    console.log(`====================================================`);
    if (config.backgroundJobsEnabled) {
      startBackgroundJobs();
      setTimeout(() => {
        requeueOrphanedEnrichments(bootTime).catch((err) => console.error("[jobs] orphaned-enrichment requeue failed:", err));
      }, config.requeueDelayMs);
    } else {
      // Loud on purpose: a container that silently is not running reminders,
      // digests or the enrichment poll looks identical to a healthy one from
      // /health alone.
      console.warn("[jobs] background jobs DISABLED via BACKGROUND_JOBS_ENABLED=false");
    }
    startKeepalivePing();
  });

  // Render redeploys and `docker stop` send SIGTERM. Stop taking work, give
  // in-flight enrichments SHUTDOWN_DRAIN_MS to finish, then hand the rest of
  // this process's leads back to the queue -- otherwise they sat at
  // "Enriching (96%)" until the 80-minute stall sweep. The requeue is capped
  // at 5s so a slow or unreachable database can never hold up shutdown.
  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[shutdown] ${signal}: draining enrichments for up to ${config.shutdownDrainMs}ms`);
    void runShutdown({
      stopJobs: () => {
        stopBackgroundJobs();
        stopClaimingEnrichments();
        if (keepaliveTimer) clearInterval(keepaliveTimer);
      },
      drain: () => waitForActiveEnrichments(config.shutdownDrainMs),
      requeue: () => Promise.race([requeueInFlightEnrichments(), new Promise<number>((resolve) => setTimeout(() => resolve(0), 5000))]),
      close: async () => {
        server.close();
        await prisma.$disconnect();
      },
    }).finally(() => process.exit(0));
  };
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
}
