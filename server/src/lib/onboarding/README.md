# Pre-filled apply link + short link

Builds a per-lead link to G3's linguist apply form with that lead's enriched
data already filled in, and the short link that carries it into outreach
messages without eating the LinkedIn character budget.

Ported from the unmerged `feat/g3-onboarding-applylink-webhook` branch, minus
the inbound submission webhook (see **Scoped out** below).

## The two URLs

**Full apply URL** (`buildApplyUrl.ts`) — `{G3_APPLY_BASE_URL}?first_name=…`,
carrying the confirmed param contract: `first_name`, `last_name`, `email`,
`address_country`, `source_language`, `target_language`, `service`,
`years_of_experience`, `vendor_experience`, `linkedin`. Any param whose
underlying field is null, or which fails to map to a value the form accepts,
is **omitted entirely** — never sent as an empty string, so the form field
stays genuinely unfilled rather than rendering as touched-but-blank.

**Short link** (`shortLink.ts`, `GET /g/:token`) — what actually goes in a
message. The full URL runs 170–500 chars and exposes the candidate's own name
and email in the visible link; a 200-char LinkedIn note could never carry it.

No database table backs this. `buildApplyUrl` is a pure function of the lead's
current row, so the whole URL is reconstructible from `lead.id` alone and the
"short code" is just that UUID base64url-encoded — 22 chars instead of 36.
`GET /g/:token` decodes it, re-fetches the lead **fresh**, and 302-redirects to
a newly built URL. Two consequences worth knowing:

- The link a candidate clicks always reflects the lead's **current** data, not
  a snapshot from whenever the message was drafted.
- Nothing about the candidate travels in the link itself.

`lead.id` is a UUIDv4 (122 bits), and this endpoint is read-only, so no
signature is needed — guessing a token is exactly as hard as guessing the id.

## Where it's wired in

`draftGenerator.ts`'s `ensureLinks()` is the single substitution point. The
prompt still describes the canonical `BRAND.apply_url`; whatever the model
writes (that URL, the bare legacy domain, or no link at all) becomes this
lead's short link before the text leaves the pipeline. That covers **both**
channels — `generateEmail` and `generateLinkedin` — and `processDraft()` now
takes the real lead id as a required parameter so a caller can't silently fall
back to an unpersonalized link.

`BRAND.apply_url` itself reads from `config.g3ApplyBaseUrl` rather than a
literal, so the apply destination is defined in exactly one place.

## Character budget

`promptBuilder.ts` does explicit arithmetic to tell the model how many
characters a LinkedIn note has left once the link is in it. That sum uses
`shortApplyUrlLength()` — the link that actually gets embedded — not
`BRAND.apply_url.length`. They differ, and budgeting against the wrong one
puts notes over the 200-char cap, which silently truncates the call to action.
`applyLink.test.ts` pins the two together.

Note the short link is *longer* than the old static `apply_url` was
(~51 chars vs 28, depending on `APP_BASE_URL`). That is the real trade: ~23
characters of note budget bought in exchange for a pre-filled form.

## Judgment calls

- **`first_name` / `last_name`** (`deriveNames`): ~88% of leads have no
  `firstName` — enrichment writes one resolved `fullName` and never splits it.
  So when `firstName` is absent and `fullName` has 2+ tokens, the first token
  becomes `first_name` and the rest `last_name`. Without this the large
  majority of candidates would get `last_name="David Buchanan"` and no first
  name. A single-token `fullName` stays in `last_name`, matching how a
  Last-Name-only entry is actually stored.
- **`vendor_experience`**: the column is `String[]`, so each element is one
  vendor and there's no comma ambiguity. A comma-delimited *string* is still
  accepted for older/free-text rows; in that shape alone, a vendor name
  containing a comma is indistinguishable from two entries — inherent to the
  value, not resolvable here. Either way each token is percent-encoded
  *before* being joined with `,`, so no token's content can corrupt the query
  string or be mistaken for the separator.
- **`years_of_experience`**: stored as `Decimal(4,1)`, the contract wants an
  integer. Rounded, not dropped — it's already an approximate metric. Zero is
  a real value; negative/non-finite is omitted.
- **Language tags**: none of the 56 `STANDARD_LANGUAGES` labels carry region
  info, so each maps to one representative region. `applyLink.test.ts` asserts
  every label still maps, so adding a language to `client/src/lib/languages.ts`
  without updating the table fails loudly instead of silently dropping the
  field. **`Arabic → ar-SA` is a defensible default, not a confirmed one** —
  dialects vary more than most, and our label carries no dialect signal.
- **Rate limiting**: an in-process fixed-window counter, not
  `express-rate-limit` — this server carries no HTTP rate-limiting dependency
  and one redirect route doesn't earn adding one. Ceiling and upgrade path are
  noted at the `ponytail:` comment in `onboardingShortLink.routes.ts`.

## Scoped out

**The inbound submission webhook.** The original branch also had G3's form
call us back on submit (`/api/webhooks/onboarding-complete/:token`, HMAC-signed
per lead) to flip the lead to `ONBOARDED` automatically, and sent a
`callback_url` param to advertise it. That half is **not** ported, so no
`callback_url` is sent — advertising a callback we don't serve would be a dead
param. Placement is marked by hand until it's built. The branch still has that
code if it's wanted later; it will need the receiver extracted into its own
routes file, since `webhooks.routes.ts` was deleted from `main` when Parallel
replaced Clay.

## Environment

`G3_APPLY_BASE_URL` defaults to `https://app.dev.global3.co/apply` — a real but
non-production host, so a dev run points somewhere real and a broken link is
visible rather than silent. **Production has no default and refuses to boot
without it**, so a prod deploy can never quietly send candidates to the dev
form. Tests pin their own value.

## Running the tests

```
cd server
npx ts-node src/lib/onboarding/applyLink.test.ts        # URL building + short link
npx ts-node src/drafting/applyLinkSubstitution.test.ts  # substitution on both channels
```

Both are plain `node:assert`, no framework, no network, no database.
