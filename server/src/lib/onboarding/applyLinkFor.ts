import { buildApplyUrl, buildApplyUrlWithin } from "./buildApplyUrl";
import { LINKEDIN_NOTE_MAX_CHARS } from "../linkedinNoteCap";

/**
 * How many of a LinkedIn note's 200 characters the apply link may take.
 *
 * Leaves 80 for the greeting and the one specific detail that makes the note
 * worth sending. Measured over real leads, a 120-char budget fits
 * first_name + last_name + email comfortably and usually a language too,
 * while the UNBUDGETED url has a median of 170 and a p90 of 419 -- 30% of
 * leads exceed 200 on the URL alone, which the invite truncates mid-URL into
 * a dead link.
 */
export const LINKEDIN_APPLY_URL_BUDGET = 120;

/**
 * Which form of the apply link a channel gets. Both are the SAME
 * app.dev.global3.co/apply URL on Global3's own domain -- no redirect
 * through our servers on either channel, and both land the candidate on the
 * same pre-filled form. They differ only in how many params they can afford.
 *
 * Email is HTML and has no length limit, so it carries every param and shows
 * a clean "app.dev.global3.co/apply" as the visible link text.
 *
 * A LinkedIn connection invite is plain text, cannot carry a hyperlink, and
 * is hard-truncated at 200 characters, so its link carries as many params as
 * fit LINKEDIN_APPLY_URL_BUDGET, highest-value first.
 */
export function applyLinkFor(channel: string, lead: Parameters<typeof buildApplyUrl>[0]): string {
  return channel === "linkedin"
    ? buildApplyUrlWithin(lead, Math.min(LINKEDIN_APPLY_URL_BUDGET, LINKEDIN_NOTE_MAX_CHARS))
    : buildApplyUrl(lead);
}
