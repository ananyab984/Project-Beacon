import { describe, it, expect } from "vitest";
import { ApiError, toApiError } from "@server/lib/apiError";

describe("ApiError", () => {
  it("carries statusCode, code, and message", () => {
    const err = new ApiError(404, "NOT_FOUND", "Not found");
    expect(err.statusCode).toBe(404);
    expect(err.code).toBe("NOT_FOUND");
    expect(err.message).toBe("Not found");
    expect(err).toBeInstanceOf(Error);
  });
});

describe("toApiError", () => {
  it("returns an ApiError unchanged", () => {
    const original = new ApiError(400, "BAD", "bad request");
    expect(toApiError(original)).toBe(original);
  });

  it("wraps a raw axios error with an upstream status into a 502 with the detail from data.message", () => {
    const axiosErr = { response: { status: 422, data: { message: "The reply subject is invalid" } } };
    const result = toApiError(axiosErr);
    expect(result.statusCode).toBe(502);
    expect(result.code).toBe("UPSTREAM_SEND_FAILED");
    expect(result.message).toContain("422");
    expect(result.message).toContain("The reply subject is invalid");
  });

  it("falls back through data.error, data.detail, data.title in that order", () => {
    expect(toApiError({ response: { status: 400, data: { error: "err-field" } } }).message).toContain("err-field");
    expect(toApiError({ response: { status: 400, data: { detail: "detail-field" } } }).message).toContain("detail-field");
    expect(toApiError({ response: { status: 400, data: { title: "title-field" } } }).message).toContain("title-field");
  });

  it("joins an errors[] array into the detail", () => {
    const axiosErr = { response: { status: 400, data: { errors: [{ detail: "first" }, { message: "second" }] } } };
    expect(toApiError(axiosErr).message).toContain("first; second");
  });

  it("produces no detail suffix when the upstream body has none of the known shapes", () => {
    const axiosErr = { response: { status: 422, data: {} } };
    const result = toApiError(axiosErr);
    expect(result.message).not.toContain(":");
    expect(result.message).toContain("(422)");
  });

  it("reads .status when there's no .response wrapper (e.g. some SDK error shapes)", () => {
    const err = { status: 401 };
    const result = toApiError(err);
    expect(result.statusCode).toBe(502);
    expect(result.message).toContain("401");
  });

  it("falls back to a plain {statusCode, code, message} shape for a non-axios, non-ApiError object", () => {
    const err = { statusCode: 409, code: "ACCOUNT_NOT_CONNECTED", message: "not connected" };
    const result = toApiError(err);
    expect(result.statusCode).toBe(409);
    expect(result.code).toBe("ACCOUNT_NOT_CONNECTED");
    expect(result.message).toBe("not connected");
  });

  it("defaults to 500/SEND_FAILED/generic message for a bare Error with no other info", () => {
    const result = toApiError(new Error("something broke"));
    expect(result.statusCode).toBe(500);
    expect(result.code).toBe("SEND_FAILED");
    expect(result.message).toBe("something broke");
  });

  it("defaults the message too when even .message is missing", () => {
    const result = toApiError({});
    expect(result.statusCode).toBe(500);
    expect(result.code).toBe("SEND_FAILED");
    expect(result.message).toBe("Failed to send message");
  });
});
