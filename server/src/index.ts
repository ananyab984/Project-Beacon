import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { config } from "./config";
import { authRouter } from "./routes/auth.routes";
import { leadRouter } from "./routes/lead.routes";
import { unipileRouter } from "./routes/unipile.routes";
import { webhooksRouter } from "./routes/webhooks.routes";
import { onboardingShortLinkRouter } from "./routes/onboardingShortLink.routes";
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
import { reportsRouter } from "./routes/reports.routes";
import { faqRouter } from "./routes/faq.routes";
import { notFoundHandler, errorHandler } from "./middleware/errorHandler";
import { startBackgroundJobs } from "./jobs";

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
app.use(express.json());
app.use(cookieParser());

// Health Check
// Root-level, not /api-prefixed -- same precedent as /health below. Kept
// short deliberately (a "URL shortener" link): the candidate-facing
// outreach message embeds "{appBaseUrl}/g/{token}" in place of the old
// static, unpersonalized apply_url.
app.use("/g", onboardingShortLinkRouter);

app.get("/health", (req, res) => {
  res.json({ status: "healthy", service: "global3-server", version: "1.0.0" });
});

// API Routes
app.use("/api/auth", authRouter);
app.use("/api/leads", leadRouter);
app.use("/api/unipile", unipileRouter);
app.use("/api/webhooks", webhooksRouter);
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
app.use("/api/faq", faqRouter);
app.use("/api", evaluationRouter);

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
  app.listen(config.port, () => {
    console.log(`====================================================`);
    console.log(`Global3 Auth Server running on http://localhost:${config.port}`);
    console.log(`Client URL: ${config.clientUrl}`);
    console.log(`====================================================`);
    startBackgroundJobs();
    startKeepalivePing();
  });
}
