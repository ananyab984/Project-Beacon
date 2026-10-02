/**
 * Single source of truth for "which platform is this lead from?".
 *
 * The bug this replaces: source was derived from a free-text label alone
 * (`mapToLeadSource`, four near-identical copies -- one here, three in the
 * client), with a blind `?? "LINKEDIN"` default and the profile URL ignored
 * entirely. So a row whose Source column said "Voices123", or was blank, or
 * said anything unrecognized, became a LINKEDIN lead -- including rows whose
 * profileLink was plainly bodalgo.com or a personal portfolio site.
 *
 * That is not just a cosmetic mislabel. `source` is what
 * enrichment_pipeline/core/source_router.py routes on, so LINKEDIN sends the
 * lead to Bright Data, which hard-rejects any non-LinkedIn URL
 * (`validation_error: Value should match pattern .*linkedin`). Measured on
 * the live DB: 5 of 93 leads with a profile link were mislabelled this way,
 * each burning a guaranteed-to-fail Tier 1 call on every enrichment run.
 *
 * The rule here: the URL is evidence, the label is a claim. A recognized host
 * wins outright. Only when the URL tells us nothing does the label get a say.
 */

export const LEAD_SOURCES = [
  "LINKEDIN",
  "PROZ",
  "ADA",
  "ATA",
  "ATAA",
  "BODALGO",
  "FREELANCER",
  "APOLLO",
  "OTHER",
] as const;

export type LeadSource = (typeof LEAD_SOURCES)[number];

/**
 * Registrable domain -> source. Matched against the URL host and every parent
 * domain of it, so `ara.proz.com` and `hrv.proz.com` (real ProZ locale
 * subdomains seen in the POC data) resolve to PROZ, while a lookalike like
 * `proz.com.evil.net` does not match at all.
 *
 * Domains confirmed from the enrichment POC datasets under POC/ rather than
 * guessed: audiodescription.co.uk (ADA), atanet.org (ATA), ataa.fr (ATAA).
 */
const HOST_TO_SOURCE: ReadonlyMap<string, LeadSource> = new Map([
  ["linkedin.com", "LINKEDIN"],
  ["proz.com", "PROZ"],
  ["audiodescription.co.uk", "ADA"],
  ["atanet.org", "ATA"],
  ["ataa.fr", "ATAA"],
  ["bodalgo.com", "BODALGO"],
  ["freelancer.com", "FREELANCER"],
  ["apollo.io", "APOLLO"],
] as const);

/** Parsed `link`, or null when it will not parse at all.
 *
 *  The single place this file turns a string into a URL. createLeadSchema
 *  already prepends a scheme, but these helpers are also called directly (the
 *  backfill script, tests), so an existing scheme is detected rather than
 *  assumed -- and detected generally, so `javascript:` arrives as itself for
 *  isUsableProfileUrl to reject rather than being hidden behind an `https://`
 *  someone glued onto the front. */
function parseUrl(link: string | null | undefined): URL | null {
  if (!link || !link.trim()) return null;
  const raw = link.trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  try {
    return new URL(withScheme);
  } catch {
    return null;
  }
}

/** Host of `link`, lowercased and stripped of a leading `www.`, or null when
 *  it is not a parseable absolute URL. */
function hostOf(link: string | null | undefined): string | null {
  return parseUrl(link)?.hostname.toLowerCase().replace(/^www\./, "") ?? null;
}

/**
 * Is this string usable as a profile URL we can actually hand to a scraper?
 *
 * `createLeadSchema` only ever prepended a scheme, so anything non-empty was
 * accepted and stored: "n/a", "TBC", a pasted name. Each of those then
 * reached Bright Data / Tavily / Parallel as a real, paid request that could
 * only fail, and `hasContact` counted the lead as contactable on the strength
 * of it.
 *
 * Rejects, in order: anything `new URL()` cannot parse (a space in the host
 * is the common one -- "not a url"); non-http(s) schemes, which also keeps
 * `javascript:` and `data:` out of a field the UI renders as a link; and
 * single-label hosts like "notaurl" or "localhost", which parse happily but
 * are never a real public profile. IP-literal hosts are rejected for the same
 * reason -- no public profile directory is addressed that way, so one here is
 * a paste error at best.
 */
export function isUsableProfileUrl(link: string | null | undefined): boolean {
  const url = parseUrl(link);
  if (!url) return false;
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (!host.includes(".")) return false;
  // Every label must be non-empty ("a..com" and a trailing dot are both out).
  const labels = host.split(".");
  if (labels.some((l) => l.length === 0)) return false;
  // A bare IPv4 literal -- the TLD would be all digits, which no real one is.
  if (/^\d+$/.test(labels[labels.length - 1])) return false;
  return true;
}

/**
 * The platform a profile URL belongs to, or null when the host is not one we
 * recognize (a personal site, an agency page, a directory we have no parser
 * for). Null is a real answer here, not a failure -- it is what lets the
 * caller distinguish "unknown platform" from "no URL at all".
 */
export function sourceFromProfileLink(link: string | null | undefined): LeadSource | null {
  const host = hostOf(link);
  if (!host) return null;
  // Walk the host and each parent domain: sub.ara.proz.com -> ara.proz.com ->
  // proz.com. Suffix-matching on a bare `endsWith(domain)` would wrongly
  // match `notlinkedin.com`, hence the label-boundary walk.
  const labels = host.split(".");
  for (let i = 0; i < labels.length - 1; i++) {
    const candidate = labels.slice(i).join(".");
    const hit = HOST_TO_SOURCE.get(candidate);
    if (hit) return hit;
  }
  return null;
}

/**
 * Best reading of a free-text Source label ("LinkedIn", "proz", "Bodalgo"),
 * or null when nothing recognizable is in it.
 *
 * Exact match is tried before substring match, and among substring matches
 * the LONGEST candidate wins. Both matter: the old implementation scanned
 * `LEAD_SOURCES` in declaration order with `upper.includes(s)`, so the label
 * "ATAA" matched "ATA" first (since "ATAA".includes("ATA")) and every ATAA
 * lead was silently filed as ATA -- a second, quieter source-detection bug in
 * the same function.
 */
export function sourceFromLabel(raw: string | null | undefined): LeadSource | null {
  if (!raw || !raw.trim()) return null;
  const upper = raw.trim().toUpperCase().replace(/[\s_-]+/g, "");
  if ((LEAD_SOURCES as readonly string[]).includes(upper)) return upper as LeadSource;
  const substringHits = LEAD_SOURCES.filter((s) => upper.includes(s));
  if (substringHits.length === 0) return null;
  return substringHits.reduce((longest, s) => (s.length > longest.length ? s : longest));
}

/**
 * The lead's source, decided from the URL first and the label second.
 *
 * Precedence, in order:
 *  1. A recognized profile-link host -- hard evidence, and it overrides the
 *     label even when they disagree. A row labelled "LinkedIn" with a
 *     bodalgo.com link is a Bodalgo lead; believing the label is exactly how
 *     the live mislabels happened.
 *  2. A URL we cannot place -> OTHER, regardless of the label. If the host is
 *     not LinkedIn's then the lead is not scrapeable as a LinkedIn profile,
 *     whatever the row claims, and the same holds for every other platform
 *     label: the URL contradicts all of them equally.
 *  3. No usable URL at all -> fall back to the label.
 *  4. Nothing recognizable anywhere -> OTHER.
 *
 * OTHER is not a dumping ground. source_router.py routes it to Parallel + LLM
 * fallback with no Tier 1 scrape, which is the correct handling for a profile
 * we have no dedicated parser for -- and strictly better than the fabricated
 * LINKEDIN this used to return, which guaranteed a rejected Bright Data call.
 */
export function detectLeadSource(
  rawLabel: string | null | undefined,
  profileLink: string | null | undefined
): LeadSource {
  const fromUrl = sourceFromProfileLink(profileLink);
  if (fromUrl) return fromUrl;
  if (hostOf(profileLink)) return "OTHER";
  return sourceFromLabel(rawLabel) ?? "OTHER";
}
