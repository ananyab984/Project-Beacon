import { buildApplyUrl, buildApplyUrlWithin } from "./buildApplyUrl";
import { buildShortApplyUrl } from "./shortLink";
import { LINKEDIN_NOTE_MAX_CHARS } from "../linkedinNoteCap";

/**
 * Budget for the alternative LinkedIn strategy below. Unused by default --
 * see USE_SHORT_LINK_ON_LINKEDIN.
 */
export const LINKEDIN_APPLY_URL_BUDGET = 120;

/**
 * Which LinkedIn strategy is in force.
 *
 * true  -- embed the SHORT link ({shortLinkBaseUrl}/g/{token}, 72 chars). The
 *          candidate clicks it and GET /g/:token redirects them to the FULL
 *          pre-filled apply URL, every param intact. Full pre-fill on a
 *          200-character note, at the cost of the visible link showing
 *          whatever host SHORT_LINK_BASE_URL points at (the bare Render
 *          hostname until that is set to a Global3 domain).
 *
 * false -- embed the real apply URL directly, carrying as many params as fit
 *          LINKEDIN_APPLY_URL_BUDGET. Always a Global3 domain with no
 *          redirect, at the cost of partial pre-fill (identity fields only;
 *          the full URL has a median of 170 chars and a p90 of 419 over real
 *          leads, so it cannot go in a note whole -- 30% of leads would be
 *          truncated mid-URL into a dead link).
 *
 * Flipping this is the whole switch; both paths are tested.
 */
const USE_SHORT_LINK_ON_LINKEDIN = true;

/**
 * Which form of the apply link a channel gets. Both channels embed the SHORT
 * link ({shortLinkBaseUrl}/g/{token}); GET /g/:token redirects the candidate
 * to the full app.dev.global3.co/apply form with their enriched data
 * pre-filled.
 *
 * Email used to embed the full pre-filled URL directly, relying on
 * plainTextToEmailHtml to hide the query string in the sent HTML. But the
 * recruiter reviews and edits the draft as PLAIN TEXT, where that URL showed
 * up as a 170-500 character wall of params -- including the candidate's own
 * name and email. The short link is what a recruiter should be approving, so
 * email now gets the same one LinkedIn does.
 *
 * A LinkedIn connection invite is plain text, cannot carry a hyperlink, and
 * is hard-truncated at 200 characters, so the full URL cannot go in whole
 * either way.
 */
export function applyLinkFor(channel: string, lead: Parameters<typeof buildApplyUrl>[0]): string {
  if (channel === "linkedin" && !USE_SHORT_LINK_ON_LINKEDIN) {
    return buildApplyUrlWithin(lead, Math.min(LINKEDIN_APPLY_URL_BUDGET, LINKEDIN_NOTE_MAX_CHARS));
  }
  return buildShortApplyUrl(lead.id);
}
