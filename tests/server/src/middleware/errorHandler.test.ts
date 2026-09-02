import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { notFoundHandler, errorHandler } from "@server/middleware/errorHandler";
import { ApiError } from "@server/lib/apiError";

function mockRes() {
  const res: any = {
    statusCode: 200,
    body: null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: any) {
      this.body = body;
      return this;
    },
  };
  return res;
}

describe("notFoundHandler", () => {
  it("404s with the method and path in the message", () => {
    const req: any = { method: "GET", path: "/api/nope" };
    const res = mockRes();
    notFoundHandler(req, res);
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: "NOT_FOUND", message: "No route for GET /api/nope" });
  });
});

describe("errorHandler", () => {
  it("serializes an ApiError using its own statusCode/code/message", () => {
    const res = mockRes();
    errorHandler(new ApiError(409, "DUPLICATE_LEAD", "already exists"), {} as any, res, vi.fn());
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ error: "DUPLICATE_LEAD", message: "already exists" });
  });

  it("serializes a ZodError as 400 VALIDATION_ERROR with a joined path:message list", () => {
    const schema = z.object({ name: z.string().min(1), age: z.number() });
    const result = schema.safeParse({ name: "", age: "not-a-number" });
    const res = mockRes();
    errorHandler(result.error, {} as any, res, vi.fn());
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe("VALIDATION_ERROR");
    expect(res.body.message).toContain("name");
  });

  it("maps Prisma P2002 (unique constraint) to 409", () => {
    const res = mockRes();
    errorHandler({ code: "P2002" }, {} as any, res, vi.fn());
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toBe("UNIQUE_CONSTRAINT");
  });

  it("maps Prisma P2025 (record not found) to 404", () => {
    const res = mockRes();
    errorHandler({ code: "P2025" }, {} as any, res, vi.fn());
    expect(res.statusCode).toBe(404);
    expect(res.body.error).toBe("NOT_FOUND");
  });

  it("falls back to a generic 500 for anything else, without leaking internal details", () => {
    const res = mockRes();
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    errorHandler(new Error("some internal stack trace detail"), {} as any, res, vi.fn());
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: "INTERNAL_ERROR", message: "Something went wrong" });
    expect(consoleSpy).toHaveBeenCalled(); // still logged server-side
    consoleSpy.mockRestore();
  });
});
