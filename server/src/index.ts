import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { config } from "./config";
import { authRouter } from "./routes/auth.routes";
import { leadRouter } from "./routes/lead.routes";
import { unipileRouter } from "./routes/unipile.routes";
import { outreachRouter } from "./routes/outreach.routes";

const app = express();

app.use(
  cors({
    origin: config.clientUrl,
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

// Health Check
app.get("/health", (req, res) => {
  res.json({ status: "healthy", service: "global3-server", version: "1.0.0" });
});

// API Routes
app.use("/api/auth", authRouter);
app.use("/api/leads", leadRouter);
app.use("/api/unipile", unipileRouter);
app.use("/api/outreach", outreachRouter);

// Start Server
app.listen(config.port, () => {
  console.log(`====================================================`);
  console.log(`Global3 Auth Server running on http://localhost:${config.port}`);
  console.log(`Client URL: ${config.clientUrl}`);
  console.log(`====================================================`);
});
