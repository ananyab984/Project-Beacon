/** Thrown by services/routes to produce a consistent {error, message} response
 *  via the central error middleware, instead of each route hand-rolling res.status(). */
export class ApiError extends Error {
  statusCode: number;
  code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

/** UnipileService throws either a plain {statusCode, code, message} object
 * (this app's own checks, e.g. ACCOUNT_NOT_CONNECTED) or lets a raw axios
 * error propagate untouched (e.g. Unipile itself rejecting the request) --
 * never an ApiError. Normalize both into one consistent shape.
 *
 * A raw axios error has NO `.statusCode` (only `.status`/`.response.status`)
 * -- three call sites previously checked `.statusCode` only, so every real
 * Unipile-side failure (wrong/missing API key, disconnected account, rate
 * limit, etc.) silently fell through to a bare 500 with axios's own generic
 * "Request failed with status code NNN" text as the message, which reads
 * exactly like OUR OWN session/auth failing -- that's what made a missing
 * UNIPILE_API_KEY look like an expired login instead of what it actually was. */
export function toApiError(err: any): ApiError {
  if (err instanceof ApiError) return err;
  const upstreamStatus = err?.response?.status ?? err?.status;
  if (upstreamStatus) {
    // Unipile's error body shape isn't consistent across endpoints -- a 422
    // from /emails was confirmed live to carry none of `message`/`error`,
    // leaving the toast with no detail at all beyond the bare status code.
    // Check every shape Unipile is known to use before giving up on a detail.
    const data = err?.response?.data;
    const detail =
      data?.message ||
      data?.error ||
      data?.detail ||
      data?.title ||
      (Array.isArray(data?.errors) ? data.errors.map((e: any) => e?.detail || e?.message || e).join("; ") : null);
    return new ApiError(
      502,
      "UPSTREAM_SEND_FAILED",
      `Unipile rejected the request (${upstreamStatus})${detail ? `: ${detail}` : ""} -- check the connected account and UNIPILE_API_KEY, this is not a Global3 session/login issue.`
    );
  }
  const status = err?.statusCode || 500;
  const code = err?.code || "SEND_FAILED";
  const message = err?.message || "Failed to send message";
  return new ApiError(status, code, message);
}
