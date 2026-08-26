# Deploying the Clay enrichment waterfall

Branch: `feat/clay-enrichment-waterfall` (5 commits, based on current `main`).

This covers what has to change outside the code itself for this branch to work
in production: env vars, the DB, and the three deployed services.

## 1. Database — already done, no action needed

Local dev's `server/.env` `DATABASE_URL` is **the same Neon database** as the
commented-out `DATABASE_URL_PROD` line in that file (same host `ep-morning-hat-af7etxp4-pooler...neon.tech`,
same DB name `neondb`). There is no separate staging DB in this project.

That means the two migrations run this session (`npx prisma migrate dev`) —
`add_lead_clay_data` and `add_lead_raw_scrape_data` — were applied **directly
against production** already. `npx prisma migrate deploy` does not need to be
run again for this branch; the columns already exist. Double-check this
assumption before relying on it if the deploy target's `DATABASE_URL` ever
changes.

## 2. `enrichment_pipeline` (Render service `project-beacon-1`)

Add one env var in Render's dashboard for this service:

- `CLAY_WEBHOOK_URL` — Clay's inbound webhook URL (the same value currently in
  local `enrichment_pipeline/.env`). Without it, `ClayClient` is never
  constructed (`self.clay = ClayClient(config) if config.clay_webhook_url else None`)
  and Stage 3.5 silently no-ops for every platform, not just skips Clay.

Then redeploy so the new `orchestrator.py`/`clay_client.py`/parser fixes ship.

## 3. `server` (Render service `project-beacon-server`)

Add two env vars:

- `CLAY_WEBHOOK_PATH_TOKEN`
- `CLAY_WEBHOOK_SECRET`

Both are read via `requireEnv(...)` in `config.ts`, so the service will
refuse to boot without them — generate **fresh** values for production rather
than reusing the local-dev ones (they were shared with Clay's UI during
testing). Generate with e.g.:

```
python3 -c "import secrets; print(secrets.token_urlsafe(32))"
```

Confirm `ENRICHMENT_SERVICE_URL=https://project-beacon-1.onrender.com` is
**not** overridden to localhost in Render's env (it was only changed in the
local, gitignored `.env` for this session's local testing — verify the
Render dashboard still has the real value, this repo change never touched
it). `DRAFTING_SERVICE_URL` is gone — see section 4, drafting is in-process now.

Add three more env vars (drafting now runs in-process here — see section 4):

- `CLAUDE_API_KEY` — copy from `drafting_service/.env`'s `CLAUDE_API_KEY`
  (or generate a fresh one; either way, don't leave the Python service's key
  active on two services longer than the overlap window in the rollout order
  below).
- `CLAUDE_MODEL=claude-haiku-4-5` — note this is the *corrected* bare model
  ID, not the stale `claude-haiku-4-5-20251001` that was in
  `drafting_service/.env` — do not copy that value over.
- `GEN_TEMPERATURE`, `REQUEST_TIMEOUT`, `MAX_RETRIES`, `RETRY_BACKOFF_BASE` —
  optional, default to `0.5`, `60`, `4`, `2.0` respectively if unset (same
  defaults the Python service used).

Then redeploy so the new webhook route, `clay.service.ts`, the false-enrichment
fix, `draftLeadPayload.ts`, and the in-process drafting module ship. Prisma
Client needs regenerating as part of the build (`prisma generate`) since
`schema.prisma` changed — this should already happen automatically if the
Render build command includes it (check `package.json`'s build script).

## 4. `drafting_service` — folded into `server`, no longer a separate deploy

Drafting was ported from the standalone Python/FastAPI service into
`server/src/drafting/` (in-process TypeScript) to remove the network hop and
the `DRAFTING_SERVICE_URL` env var entirely — the same class of
local-vs-Render misconfiguration bug this session already hit once. See
`server/scripts/verify-drafting-port.ts` (pure-function parity: readability
scoring, edit-similarity metric) and `server/scripts/diff-drafting-port.ts`
(real-lead comparison against the Python service's own output) for how this
was verified before cutover — both passed cleanly.

**Keep the Render service `project-beacon-1-python` running, unmodified, for
one deploy cycle** after `server` ships this change, as a rollback reference
— don't redeploy or decommission it yet. Once the in-process path has run in
production without incident:

1. Delete the `project-beacon-1-python` Render service.
2. Remove `drafting_service/` from the repo in a follow-up commit.
3. Remove `DRAFTING_SERVICE_URL` from anywhere it might still be set (it's
   already gone from `server`'s own config as of this branch).

## 5. Clay UI — point the webhook at production

The HTTP API action in Clay currently points at the local Cloudflare Quick
Tunnel URL used for dev testing (ephemeral, changes on every restart). Once
`server` is redeployed:

1. In Clay's HTTP API action, update the Endpoint to:
   `https://project-beacon-server.onrender.com/api/webhooks/clay/<CLAY_WEBHOOK_PATH_TOKEN>`
   using the **new production** path token from step 3, not the local one.
2. Update the secret header value to the **new production** `CLAY_WEBHOOK_SECRET`.
3. Leave the JSON body / column mapping (`source_row_index`, `contact_details`,
   `linkedin_enrichment`, the `{{Enrich Person JSON}}` formula column) as-is —
   none of that changed this session.

## 6. Client

No env/config changes. Standard rebuild/redeploy of the static client is
sufficient — it only consumes new fields the API already returns.

## Rollout order

DB is already live, so order only matters for the services:

1. `enrichment_pipeline` — safe first; Stage 3.5 just won't fire until
   `CLAY_WEBHOOK_URL` is set, no behavior change otherwise.
2. `server` — deploy with the three new Claude env vars set *before* this
   deploy goes live, or every draft request 502s (`processDraft` throws if
   `CLAUDE_API_KEY` is unset, mirroring the old service's own behavior).
3. Point Clay's webhook at prod (step 5) only after `server` is live with the
   new env vars, or Clay's callbacks will 401/404 in the gap.
4. Leave `project-beacon-1-python` running untouched for one deploy cycle
   (rollback reference), then decommission per section 4.

## Not part of this deploy

Left uncommitted/untracked on purpose (scratch and unrelated exploration from
this session, not needed in production):
`enrichment_pipeline/scratch_*.py`, `drafting_service/scratch_build_drafting_output.py`,
`POC's/clay_poc/`, `POC's/linkedin_poc/firecrawl_*` + its `.env.example` diff,
and the `Documents/*.pdf` research reports.
