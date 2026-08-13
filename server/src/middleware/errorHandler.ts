import { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { ApiError } from "../lib/apiError";

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ error: "NOT_FOUND", message: `No route for ${req.method} ${req.path}` });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: any, req: Request, res: Response, next: NextFunction) {
  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({ error: err.code, message: err.message });
  }

  if (err instanceof ZodError) {
    return res.status(400).json({
      error: "VALIDATION_ERROR",
      message: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    });
  }

  // Prisma known-error codes worth surfacing distinctly.
  if (err?.code === "P2002") {
    return res.status(409).json({ error: "UNIQUE_CONSTRAINT", message: "A record with that value already exists" });
  }
  if (err?.code === "P2025") {
    return res.status(404).json({ error: "NOT_FOUND", message: "Record not found" });
  }

  console.error(err);
  return res.status(500).json({ error: "INTERNAL_ERROR", message: "Something went wrong" });
}
