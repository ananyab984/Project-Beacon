import type { Lead } from "@prisma/client";
import { config } from "../../config";
import { countryToIso2 } from "./countryToIso2";
import { languageToBcp47 } from "./languageToBcp47";
import { serviceToApplyCode } from "./serviceToApplyCode";
import { vendorExperienceToPresetList } from "./vendorExperienceToPresets";
import { signLeadId } from "./callbackToken";

// A conservative, widely-compatible ceiling -- old IE's 2083-char cap is
// still a common defensive baseline for "will this URL work everywhere."
// This form has a small, fixed field count today, so hitting this in
// practice would mean something is already wrong (e.g. a runaway
// vendor_experience value) -- catch it here rather than in a bug report.
const URL_LENGTH_WARNING_THRESHOLD = 2000;

type LeadForApplyUrl = Pick<
  Lead,
  | "id"
  | "firstName"
  | "fullName"
  | "email"
  | "country"
  | "sourceLanguage"
  | "targetLanguage"
  | "services"
  | "yearsOfExperience"
  | "vendorExperience"
  | "profileLink"
>;

/**
 * Our Lead model has firstName + fullName, never a dedicated lastName
 * field (the "Add a Lead" form's own "Last Name" input is concatenated
 * into fullName on save -- see add-lead-dialog.tsx). Deriving last_name
 * back out for this form is therefore its own small mapping decision:
 *  - No firstName on file at all -> the whole fullName is the best signal
 *    we have (matches how a lead entered via Last Name alone, no First
 *    Name, is actually stored: fullName === that last name).
 *  - fullName is exactly firstName -> no last-name portion exists; omit.
 *  - fullName starts with "firstName " -> the remainder is the last name.
 *  - Anything else (e.g. legacy/imported data where the two were never
 *    composed together) -> fall back to the last whitespace-separated
 *    token, rather than omitting last_name entirely when we do have a
 *    full name on file.
 */
export function deriveLastName(lead: Pick<Lead, "firstName" | "fullName">): string | undefined {
  const full = (lead.fullName || "").trim();
  if (!full) return undefined;
  const first = (lead.firstName || "").trim();

  if (!first) return full;
  if (full.toLowerCase() === first.toLowerCase()) return undefined;
  if (full.toLowerCase().startsWith(`${first.toLowerCase()} `)) {
    return full.slice(first.length).trim() || undefined;
  }

  const parts = full.split(/\s+/).filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 1] : undefined;
}

/**
 * `profileLink` is a generic single field shared by LinkedIn and ProZ URLs
 * (see Lead.profileLink's schema comment) -- only surface it as `linkedin`
 * when it's actually a LinkedIn URL. Same regex convention already used
 * elsewhere in this codebase (lead.routes.ts's isLinkedInLead check) for
 * consistency, so the two checks can't silently drift apart.
 */
export function extractLinkedInUrl(profileLink: string | null | undefined): string | undefined {
  if (!profileLink) return undefined;
  const trimmed = profileLink.trim();
  if (!trimmed) return undefined;
  return /linkedin\.com/i.test(trimmed) ? trimmed : undefined;
}

function encodeSegment(key: string, encodedValue: string): string {
  return `${encodeURIComponent(key)}=${encodedValue}`;
}

/**
 * `callback_url` is its own well-formed URL, with the lead id as its own
 * query param, independent of and encoded separately from the outer apply
 * link's params -- then the ENTIRE value gets encoded once more before
 * being appended to the apply link, since it's a URL nested inside
 * another URL's query string.
 */
export function buildCallbackUrl(leadId: string): string {
  const url = new URL(
    `${config.appBaseUrl}/api/webhooks/onboarding-complete/${config.onboardingWebhookPathToken}`
  );
  url.searchParams.set("lead_id", leadId);
  url.searchParams.set("sig", signLeadId(leadId));
  return url.toString();
}

/**
 * Builds the full https://app.global3.io/apply query string for a lead,
 * per the confirmed contract. Every param is omitted entirely (never sent
 * as an empty string or a placeholder) when the underlying field is
 * null/unknown or fails to map to a value G3's form would accept.
 *
 * This lead's single services[0] / sourceLanguage / targetLanguage is what
 * gets sent -- the form only accepts one service + one language pair, and
 * (as of now) a lead only carries one such pair, so there's no
 * multi-row selection decision to make here.
 */
export function buildApplyUrl(lead: LeadForApplyUrl): string {
  const segments: string[] = [];

  const push = (key: string, rawValue: string | number | undefined | null) => {
    if (rawValue === undefined || rawValue === null) return;
    const str = String(rawValue).trim();
    if (!str) return;
    segments.push(encodeSegment(key, encodeURIComponent(str)));
  };

  push("first_name", lead.firstName);
  push("last_name", deriveLastName(lead));
  push("email", lead.email);
  push("address_country", countryToIso2(lead.country));
  push("source_language", languageToBcp47(lead.sourceLanguage));
  push("target_language", languageToBcp47(lead.targetLanguage));
  push("service", serviceToApplyCode(lead.services?.[0]));

  if (lead.yearsOfExperience != null) {
    const raw = lead.yearsOfExperience.toNumber();
    if (Number.isFinite(raw) && raw >= 0) {
      // The contract wants a plain integer; years-of-experience is already
      // a fuzzy/approximate metric on our side (stored to one decimal
      // place only for finer internal tracking) -- rounding to the
      // nearest whole year for this external form is a reasonable,
      // intentional approximation, not "sending garbage." A negative or
      // non-finite value (shouldn't occur given our own constraints, but
      // defensive per the spec) is omitted rather than serialized.
      push("years_of_experience", Math.round(raw));
    }
  }

  const vendorList = vendorExperienceToPresetList(lead.vendorExperience);
  if (vendorList.length > 0) {
    // Encode each vendor value BEFORE joining, not after -- a raw comma or
    // any other reserved character inside one vendor's own name must not
    // be mistaken for the "," list separator once this gets parsed back
    // apart on the receiving end. Only the literal "," characters inserted
    // here, between already-encoded values, are the real separators.
    const joined = vendorList.map((v) => encodeURIComponent(v)).join(",");
    segments.push(encodeSegment("vendor_experience", joined));
  }

  push("linkedin", extractLinkedInUrl(lead.profileLink));

  const callbackUrl = buildCallbackUrl(lead.id);
  segments.push(encodeSegment("callback_url", encodeURIComponent(callbackUrl)));

  const url = `${config.g3ApplyBaseUrl}?${segments.join("&")}`;

  if (url.length > URL_LENGTH_WARNING_THRESHOLD) {
    console.warn(
      `[onboarding] Apply URL for lead ${lead.id} is ${url.length} chars, over the ${URL_LENGTH_WARNING_THRESHOLD}-char safety threshold -- check for a runaway field value before this reaches a real browser.`
    );
  }

  return url;
}
