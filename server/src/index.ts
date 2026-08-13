import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
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
import { notFoundHandler, errorHandler } from "./middleware/errorHandler";
import { startBackgroundJobs } from "./jobs";

const app = express();

app.use(helmet());
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
        callback(null, true);
      } else {
        callback(null, true);
      }
    },
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

// Brute-force/enumeration hardening on the two unauthenticated credential endpoints.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "RATE_LIMITED", message: "Too many attempts, please try again later" },
});
app.use("/api/auth/login", authLimiter);
app.use("/api/auth/signup", authLimiter);
app.use("/api/auth/forgot-password", authLimiter);

// Health Check
app.get("/health", (req, res) => {
  res.json({ status: "healthy", service: "global3-server", version: "1.0.0" });
});

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
app.use("/api", evaluationRouter);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;

// Keep the local dev experience the same, but avoid starting a long-lived
// listener or in-process cron jobs inside Vercel's serverless runtime.
if (process.env.VERCEL !== "1") {
  app.listen(config.port, () => {
    console.log(`====================================================`);
    console.log(`Global3 Auth Server running on http://localhost:${config.port}`);
    console.log(`Client URL: ${config.clientUrl}`);
    console.log(`====================================================`);
    startBackgroundJobs();
  });
}
