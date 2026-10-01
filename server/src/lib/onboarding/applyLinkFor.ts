import type { Lead } from "@prisma/client";
import { buildApplyUrl } from "./buildApplyUrl";
import { buildShortApplyUrl } from "./shortLink";

/**
 * Which form of the apply link a given channel should carry.
 *
 * Email is HTML (unipile.service.ts's plainTextToEmailHtml), so it embeds the
 * FULL pre-filled URL and lets the renderer show a clean
 * "app.dev.global3.co/apply" as the visible text. The candidate therefore
 * sees Global3's own domain and is never redirected through our server --
 * there is no length pressure in an email, and the median URL is ~170 chars.
 *
 * A LinkedIn connection note is plain text capped at 200 characters and
 * cannot carry a hyperlink, so the full URL is impossible there: at a median
 * of 170 it would leave 30 characters for the message, and the p90 lead
 * (396) exceeds the cap on its own. It gets the short link instead.
 */
export function applyLinkFor(channel: string, lead: Parameters<typeof buildApplyUrl>[0]): string {
  return channel === "linkedin" ? buildShortApplyUrl(lead.id) : buildApplyUrl(lead);
}
