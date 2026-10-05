import axios from "axios";
import { retryWithBackoff, isRetryableByDefault } from "./retryWithBackoff";

// Where a Google Sheets CSV actually comes from: the export/publish URL lives
// on docs.google.com and 307-redirects to a *.googleusercontent.com download
// host. Nothing else is a legitimate source for this importer.
const ALLOWED_HOST = /^(docs\.google\.com|[a-z0-9-]+\.googleusercontent\.com)$/i;
const MAX_REDIRECTS = 5;

/** Thrown for a URL the importer refuses to fetch -- never retried. */
export class UnsafeSheetUrlError extends Error {}

/**
 * SSRF guard (audit P0-6). The sheet URL comes straight from the caller, and
 * before this the server would fetch ANY address -- cloud metadata
 * (169.254.169.254), localhost, the private network, internal service names.
 * Only https on a Google Sheets host is accepted. A host allowlist (rather
 * than resolving and checking IPs) means there is no DNS trick to get round:
 * whoever owns docs.google.com decides where it points, not the caller.
 */
export function assertGoogleSheetsUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeSheetUrlError("That doesn't look like a valid Google Sheet link.");
  }
  const portOk = url.port === "" || url.port === "443";
  if (url.protocol !== "https:" || !ALLOWED_HOST.test(url.hostname) || !portOk || url.username || url.password) {
    throw new UnsafeSheetUrlError("Only Google Sheets links (https://docs.google.com/spreadsheets/...) can be imported.");
  }
  return url;
}

/**
 * Fetches a Google Sheets CSV export URL and returns its raw text.
 * Previously copy-pasted identically in sheet-sync.routes.ts and
 * lead.routes.ts, including a single un-retried 15s-timeout GET -- now one
 * shared, retried, deadline-bounded fetch (both call sites already used
 * 15000ms as a per-attempt timeout; that's now also the true wall-clock cap
 * across the whole retry sequence, not just one attempt).
 *
 * Redirects are followed by hand, re-checking every hop against the same
 * allowlist: axios's own redirect-following would let an allowed host bounce
 * the request into a private address after the first check passed.
 *
 * Throws a plain Error (message suitable to surface directly to a user) if
 * the URL is refused, the fetch fails, or the response looks like an HTML
 * sign-in page instead of CSV data -- callers decide how to turn that into a
 * response (JSON 400, ApiError, etc.), since the two call sites differ.
 */
export async function fetchCsv(url: string): Promise<string> {
  const start = assertGoogleSheetsUrl(url).toString();

  let csvData: string;
  try {
    const response = await retryWithBackoff(
      async (signal) => {
        let target = start;
        for (let hop = 0; ; hop++) {
          const res = await axios.get(target, {
            timeout: 15000,
            headers: { Accept: "text/csv, text/plain, */*" },
            maxRedirects: 0,
            validateStatus: (s) => s >= 200 && s < 400,
            signal,
          });
          if (res.status < 300) return res;
          const location = res.headers?.location;
          if (!location || hop >= MAX_REDIRECTS) {
            throw new UnsafeSheetUrlError("Google Sheet redirected too many times. Check the link and try again.");
          }
          target = assertGoogleSheetsUrl(new URL(location, target).toString()).toString();
        }
      },
      { deadlineMs: 15000, isRetryable: (err) => !(err instanceof UnsafeSheetUrlError) && isRetryableByDefault(err) }
    );
    csvData = String(response.data);
  } catch (err: any) {
    throw new Error(err?.message || "Failed to fetch CSV from Google Sheet. Ensure the sheet is accessible.");
  }

  if (csvData.includes("<!DOCTYPE html") || csvData.includes("<html")) {
    throw new Error("Google Sheet returned an HTML sign-in page. Please make the sheet public with 'Anyone with the link can view'.");
  }

  return csvData;
}
