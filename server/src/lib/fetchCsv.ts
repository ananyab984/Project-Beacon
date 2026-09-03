import axios from "axios";
import { retryWithBackoff } from "./retryWithBackoff";

/**
 * Fetches a Google Sheets CSV export URL and returns its raw text.
 * Previously copy-pasted identically in sheet-sync.routes.ts and
 * lead.routes.ts, including a single un-retried 15s-timeout GET -- now one
 * shared, retried, deadline-bounded fetch (both call sites already used
 * 15000ms as a per-attempt timeout; that's now also the true wall-clock cap
 * across the whole retry sequence, not just one attempt).
 *
 * Throws a plain Error (message suitable to surface directly to a user) if
 * the fetch fails or the response looks like an HTML sign-in page instead of
 * CSV data -- callers decide how to turn that into a response (JSON 400,
 * ApiError, etc.), since the two existing call sites do this differently.
 */
export async function fetchCsv(url: string): Promise<string> {
  let csvData: string;
  try {
    const response = await retryWithBackoff(
      (signal) =>
        axios.get(url, {
          timeout: 15000,
          headers: { Accept: "text/csv, text/plain, */*" },
          maxRedirects: 5,
          signal,
        }),
      { deadlineMs: 15000 }
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
