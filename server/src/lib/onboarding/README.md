# Onboarding pre-fill link + submission webhook

Implements the `buildApplyUrl(lead)` link generator and the
`/api/webhooks/onboarding-complete/:token` receiver for `app.global3.io`'s
linguist onboarding form, per the confirmed contract with G3's tech team.

## The one decision this needed a call on (now resolved)

**Multi-service-row leads:** a `Lead` can in principle carry more than one
service/language-pair, but the apply form only accepts one `service` + one
`source_language`/`target_language` triple. **Resolved: the form takes in
one service/language pair only for now**, so `buildApplyUrl` simply sends
`lead.services[0]` with `lead.sourceLanguage`/`lead.targetLanguage` — no
selection logic (primary/most-recent/etc.) was built, since there's
currently nothing to select between. If a lead ever needs to carry
multiple rows that this form must choose between, that selection rule is
a decision to make explicitly at that point, not something to infer from
this code.

## Other judgment calls made along the way (documented in place, listed here for visibility)

- **`last_name`**: `Lead` has `firstName` + `fullName`, never a dedicated
  last-name field — the "Add a Lead" form's own Last Name input is
  concatenated into `fullName` on save. `deriveLastName()` in
  `buildApplyUrl.ts` reconstructs it (strip a matching `firstName` prefix
  off `fullName`; fall back to the last whitespace-separated token, or the
  whole `fullName` when there's no `firstName` on file at all).
- **`years_of_experience`**: our field allows one decimal place
  (`Decimal(4,1)`); the contract wants a plain integer. Rounded to the
  nearest whole year rather than omitted — years-of-experience is already
  an approximate metric on our side, so this is treated as a reasonable
  approximation, not "sending garbage." Zero is sent as a real value (not
  treated as empty); negative/non-finite values are omitted defensively.
- **Language BCP47 tags**: none of our 56 `STANDARD_LANGUAGES` labels carry
  region info, so every entry in `languageToBcp47.ts` picks one
  representative region, documented per-language where the choice isn't
  obvious. **Flagged specifically: `Arabic → ar-SA`** — Arabic dialects
  vary more than most languages here (Gulf/Egyptian/Levantine/Maghrebi),
  and our plain "Arabic" label carries no dialect signal at all. This is a
  defensible default, not a confirmed one — worth revisiting once the real
  regional distribution of our Arabic-speaking candidate pool is known.
- **`vendor_experience` comma ambiguity**: `Lead.vendorExperience` is
  unescaped, comma-delimited free text (same convention already used in
  `drafting/draftGenerator.ts`). A vendor name that itself contains a
  comma (e.g. "Smith, Inc.") is indistinguishable from two separate
  entries *before* it ever reaches `vendorExperienceToPresetList` — that
  ambiguity is inherent to the source field, not something this code can
  resolve. What `buildApplyUrl` does guarantee: once it has a list of
  tokens, each is percent-encoded individually before being joined with
  `,` for output, so no token's own content can corrupt the outer query
  string or be mistaken for the list separator on the way back out.
- **StageHistory attribution for a webhook-triggered transition**:
  `StageHistory.changedByRecruiterId` is a required column (every existing
  writer is an authenticated PATCH request with a real `req.user.id`) —
  deliberately **not** changed to nullable for this feature, to avoid a
  schema migration against a database this build couldn't confirm was safe
  to touch. `markLeadOnboarded()` (in `lead.service.ts`) instead attributes
  the transition to `lead.assignedRecruiterId`, falling back to
  `lead.createdByRecruiterId`. In the rare case neither is on file, the
  lead is still marked `ONBOARDED` (the state change that matters) but the
  `StageHistory` audit row is skipped, with a clear `console.warn` noting
  why — a documented, narrow gap rather than a blocked transition or an
  invented attribution.
- **No new database table**: idempotency for the webhook comes entirely
  from checking the lead's own current `stage` (already `ONBOARDED` →
  no-op) rather than a dedicated dedupe-events table like Unipile's — this
  webhook fires once per lead ever, so state-based idempotency is
  sufficient, and it avoids a second schema change alongside the one above.
  Every call (accepted, duplicate, and every rejection reason) is still
  logged via `console.log`/`console.warn`/`console.error` with the
  `[onboarding webhook]` tag, so a real issue can be debugged from this
  server's own logs without asking G3 "did it work on your end?".
- **`markLeadOnboarded()` is standalone**, not extracted from
  `lead.routes.ts`'s existing `PATCH /:id` ONBOARDED branch (higher-traffic,
  already-proven code serving every stage transition in the product
  today). The Requirement/ClientDemand headcount sync in
  `markLeadOnboarded()` intentionally mirrors that branch's logic — keep
  the two in sync by hand if either changes.

## No live call reachable by default (confirmed)

`config.g3ApplyBaseUrl` defaults to `https://mock-g3-apply.invalid/apply`
(the `.invalid` TLD is reserved by RFC 2606 to never resolve) everywhere
except production, and is only ever used to build a *string* — no code
path anywhere calls it over the network. The one place it's used for a
real domain is `scripts/verify-g3-apply-live.ts`, which refuses to run
unless `G3_APPLY_ALLOW_LIVE=true` **and** a real `G3_APPLY_BASE_URL` are
both set explicitly for that one invocation.

## Running the tests

```
cd server
npm test               # runs everything under src/**/*.test.ts (this feature's tests)
```

## One-time manual verification against the real G3 domain

Not part of the automated suite, not run by any script automatically —
see the header comment in `scripts/verify-g3-apply-live.ts` for the exact
invocation and what it does and doesn't do.
