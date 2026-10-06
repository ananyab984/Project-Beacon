# Docker deployment runbook

The G3 backend ships as **one image running two processes**:

| Process | Binds | Role |
|---|---|---|
| `[node]` Express API | `0.0.0.0:$PORT` (default 5001) | public API, 9 cron jobs |
| `[python]` FastAPI enrichment | `127.0.0.1:8001` | private; only Node can reach it |

`docker/start.sh` supervises both. The frontend (`client/`) deploys separately.

`render.yaml` is **not** used by this image. It still describes the old two-service
setup and is kept as a rollback path.

---

## Why one container

The Node→Python enrichment call has a **70-minute** axios timeout
(`enrichment.job.ts:172`, backed by a ~73-minute outer retry deadline). That single
fact rules out most topologies:

- **AWS App Runner** caps requests at **120 seconds** and it is not configurable.
- An **ECS ALB** idle timeout maxes at 4000s — still under the 4200s the client allows.
- **Render**'s proxy allows ~100 minutes, which is why the old two-service setup worked.

Keeping both processes in one container makes that call a **loopback request** that
never touches any proxy, so none of the above applies. It also means
`ENRICHMENT_SERVICE_SHARED_SECRET` is one value in one environment and cannot drift.

Splitting the containers would buy no scaling headroom either — see
[one replica only](#one-replica-only).

---

## Build

### For deployment: one image, both CPU types

```bash
docker/build-multiarch.sh <account>.dkr.ecr.<region>.amazonaws.com/g3-backend:1.0.0
# or, in GitHub: Actions -> "Build backend image" -> Run workflow
```

This builds the image for **both** `linux/amd64` (Intel/AMD) and `linux/arm64`
(ARM / AWS Graviton) and pushes them under one tag. Whoever deploys can choose either
kind of server; Docker/AWS pulls the matching half automatically. Add `SMOKE_TEST=1`
to start each half once after pushing and confirm Node, Python and the Prisma engine
load on that CPU.

Multi-arch images must be **pushed to a registry** (ECR, GHCR, ...): a single
machine's local image store can't hold both halves under one tag.

Why the CPU type matters at all: the image contains compiled programs (Node, Python,
numpy/pandas, and Prisma's query engine). Those only run on the CPU type they were
built for. A wrong-arch image starts cleanly and then dies on its first database query,
because Prisma loads its engine lazily. `schema.prisma` now generates both Linux
engines (`debian-openssl-3.0.x` and `linux-arm64-openssl-3.0.x`), and the Dockerfile
fails the build if the engine for the platform being built is missing.

Expect a laptop build to be slow: the half that doesn't match your own CPU is
emulated (10-25 min for amd64 on an Apple Silicon Mac). The GitHub workflow caches
layers, so rebuilds after small changes are much faster.

### For local testing

```bash
docker build -t g3-backend:local .     # your own machine's CPU type only
```

---

## Run locally

```bash
cp .env.docker.example .env.docker   # fill in -- see the file's own notes
docker compose up --build
curl localhost:5001/health           # -> {"status":"healthy"}
```

Do **not** point `env_file` at `server/.env`. It carries a real `SLACK_BOT_TOKEN`, real
`APP_BASE_URL`/`CLIENT_URL`, and an `ENRICHMENT_SERVICE_URL` that would override the
image default and send Node to the *old public* Python service.

Useful checks:

```bash
# Python is reachable inside, and only inside
docker exec g3-backend curl -fsS 127.0.0.1:8001/health
curl localhost:8001/health            # must FAIL -- it binds loopback

# Which provider tiers are actually wired up ("healthy" alone is misleading)
docker exec g3-backend curl -fsS 127.0.0.1:8001/health | python3 -m json.tool

# Supervisor behaviour
# Python dies -> start.sh restarts it in place; /health on 5001 never drops.
docker exec g3-backend pkill -9 -f "main.py --serve"
# Node dies -> start.sh exits, the platform restarts the whole container.
docker exec g3-backend pkill -9 -f "dist/index.js"

docker inspect -f '{{.RestartCount}}' g3-backend
docker logs g3-backend | grep -E "WARNING: python|node exited"
```

Note `localhost:8001` on your own machine is **not** this container's enrichment
service — it binds loopback *inside* the container and is published nowhere. If
something answers there, it is an unrelated local process. Confirm by payload: ours
reports `"service": "enrichment_pipeline"`.

`docker/start.test.sh` is a standalone self-check for the supervision loop (stubbed
processes, no Docker required).

---

## Operating rules

### One replica only

Run **exactly one instance**. Two is not a degraded configuration, it is a broken one:

- `pollInFlight` (`server/src/jobs/enrichment.job.ts`) is an **in-memory** boolean
  that caps enrichment at `ENRICHMENT_CONCURRENCY`. N replicas means N× that many
  concurrent calls against a Python service whose pools are sized for one.
- Startup requeue (`requeueOrphanedEnrichments`) treats every lead left `IN_PROGRESS`
  from before this boot as orphaned -- a second live backend's in-flight leads would be
  requeued under it. The same applies to **any** second backend on the same database
  (another Render service, a laptop running `npm run dev` with the prod `.env`).
- The cron jobs claim each tick once per `NODE_ENV` (`cronLock.ts`), but a second
  backend still splits the jobs unpredictably between the two.

App Runner: min = max = 1. ECS: `desiredCount: 1` **and** `maximumPercent: 100`, so a
rolling deploy cannot briefly run two.

### Health check

Path `/health`, and allow a generous start period — `prisma migrate deploy` walks 27
migrations before Node listens. 120s is the configured default.

### Deploying mid-batch

Safe now. On SIGTERM Node stops claiming, lets in-flight leads finish for
`SHUTDOWN_DRAIN_MS`, then puts whatever is still running back to `PENDING` -- the next
instance picks those up on its first tick (`index.ts`, `lib/gracefulShutdown.ts`). If
the process is killed before that runs (a crash, an OOM), the next boot requeues them
after `REQUEUE_DELAY_MS`. The 80-minute `stallOverdueEnrichments` sweep remains only as
the net for a genuinely hung run. A lead that was mid-run starts over, but its paid
Parallel work isn't repeated when the enrichment service outlived Node (separate Render
services): the re-claimed lead collects the stored result (`waitWhileBusy` +
`LeadRunRegistry`).

### Memory: 2GB minimum

Python can hold up to 40 concurrent enrichment threads. 512MB will OOM.

Bulk uploads no longer fan out: they queue `PENDING` leads and the poller runs at most
`ENRICHMENT_CONCURRENCY` at once. Size memory for that number (see "Enrichment
throughput" below).

### Environment variables the image already sets

Platform environment **overrides** the image's `ENV`. Do not set these by hand:

```
NODE_ENV  PORT  ENRICHMENT_PORT  ENRICHMENT_SERVICE_URL  KEEPALIVE_*  TZ
```

A leftover `ENRICHMENT_SERVICE_URL` in a Render dashboard or ECS task definition is the
single easiest way to break this deployment: Node keeps calling the old public Python
service, and the failure looks like a network error rather than a config mistake.

If you ever must override it, a trailing slash is now stripped (`config.ts`).

### Pre-flight: 10 variables

Missing any one of these is a crash loop, not a degraded start.

Throw inside `config.ts` at import, before Express listens:

1. `UNIPILE_API_KEY`
2. `UNIPILE_WEBHOOK_SECRET`
3. `UNIPILE_WEBHOOK_PATH_TOKEN`
4. `ENRICHMENT_SERVICE_SHARED_SECRET`
5. `NEON_AUTH_URL`

Same, but only under `NODE_ENV=production` (which the image sets):

6. `APP_BASE_URL`
7. `CLIENT_URL`
8. `UNIPILE_DSN`
9. `ENRICHMENT_SERVICE_URL`

Fails differently — `config.ts` never checks it, so it surfaces later at
`prisma migrate deploy`:

10. `DATABASE_URL`

### Frontend wiring

`CLIENT_URL` must be the frontend's real origin or CORS rejects every browser request,
and the frontend's `VITE_API_BASE_URL` must point at this container's URL.

---

## Deploy: AWS

### Option A — App Runner (simplest)

Viable **only** because the 70-minute call is loopback. Its 120s request cap applies to
inbound API traffic, which is all fast.

1. Push to ECR with `docker/build-multiarch.sh` (both CPU types).
2. Create an App Runner service from the image.
3. Port `5001`, health check **HTTP** on `/health`.
4. **Auto-scaling: min 1, max 1.**
5. At least 4 GB memory (App Runner couples CPU/memory; 2 vCPU / 4 GB is the practical floor).
6. Add every variable from the pre-flight list.

Caveat: App Runner gives no control over long-running *inbound* requests, so if a future
feature needs one, this is a dead end.

### Option B — ECS Fargate (most control)

1. Push to ECR.
2. Task definition: 1 vCPU / 2–4 GB, one container, port 5001.
3. Service: `desiredCount: 1`, `maximumPercent: 100`, `minimumHealthyPercent: 0`,
   autoscaling off. Container `stopTimeout: 120` (the Fargate maximum) with
   `SHUTDOWN_GRACE_SECONDS=110`, `SHUTDOWN_DRAIN_MS=90000`,
   `PY_GRACEFUL_SHUTDOWN_SECONDS=100`, `REQUEUE_DELAY_MS=0`.
4. ALB target group health check `/health`, healthy threshold generous enough for the
   migration window.
5. Set the ALB idle timeout high (max 4000s) — it governs inbound traffic only, but a
   low value will cut long dashboard requests.
6. Secrets via SSM Parameter Store or Secrets Manager rather than plain task-definition
   environment.

Pick this if you want control over memory, graceful stop timeout, or log routing.

### Option C — EC2 + compose (cheapest, most manual)

1. EC2 instance with Docker, ≥4 GB RAM.
2. Copy `docker-compose.yml` and a filled `.env.docker`.
3. `docker compose up -d` — `restart: unless-stopped` handles reboots.
4. Put nginx/Caddy in front for TLS.

You own patching and uptime. Fine for a single-replica internal tool.

### Region

Put it close to the Neon database — every request makes multiple round trips.

---

## Deploy: Render (Docker runtime)

Still supported, and the lowest-friction migration since the env var names are
unchanged.

1. New → Web Service → **Docker** runtime, Dockerfile at the repo root.
2. Instance type with **≥2 GB** RAM. Not free tier — enrichment far exceeds its limits.
3. Health check path `/health`.
4. **Scaling: 1 instance.**
5. Add the pre-flight variables.
6. **Delete `ENRICHMENT_SERVICE_URL` and `KEEPALIVE_URL`** from the environment group if
   migrating from the old blueprint. This is the one step most likely to be missed.

Leave the old `render.yaml` services *suspended*, not deleted, until the new service is
verified — see below.

---

## Go-live sequence

1. **Unipile webhooks for already-connected accounts.** The highest-risk item. Accounts
   connected before the move keep posting replies to the **old `APP_BASE_URL`**; if the
   backend's address changes, those replies silently stop arriving — no error, just
   nothing. Either front the new backend with the same custom domain, or update /
   reconnect each existing account.
2. **Shut down the old Render services once the new one is verified.** Running both means
   both execute all 9 cron jobs, so every digest and reminder goes out twice, and both
   can claim the same pending leads and pay to enrich them twice.
3. **Rebuild the frontend** with the new `VITE_API_BASE_URL`, and set `CLIENT_URL` to the
   frontend's real origin.
4. **Remove stale variables** on the new host (see above).
5. **Verify after deploy**, not just `/health`:
   ```bash
   curl https://<host>/health
   # and from a shell on the container:
   curl -fsS 127.0.0.1:8001/health   # check providers_configured, not just "healthy"
   ```
   `/health` returns `healthy` with zero provider keys configured. A green deploy that
   enriches nothing is the failure mode to watch for.

---

## Enrichment throughput

Each lead takes ~1-3 minutes (Parallel `core` dominates); throughput is how many run at
once. One variable sets it for both processes -- the same container on AWS, both Render
services on Render:

| Variable | Default | What it does |
|---|---|---|
| `ENRICHMENT_CONCURRENCY` | 16 (1-128) | Node's poller width; Python's per-lead pools (`N+8`), provider pool (`max(20, 2N+8)`), request threads (`max(40, N+16)`). Node and Python **must** match. |
| `SHUTDOWN_DRAIN_MS` | 20000 | SIGTERM: let in-flight leads finish this long, then requeue the rest. Below the platform's kill window. |
| `REQUEUE_DELAY_MS` | 300000 | After boot, requeue leads an earlier process left `IN_PROGRESS`. 0 on AWS. |
| `PY_GRACEFUL_SHUTDOWN_SECONDS` | 25 | uvicorn's grace for running requests. |
| `SHUTDOWN_GRACE_SECONDS` | 30 | `start.sh`: how long both children get before SIGKILL. |
| `BULK_UPLOAD_MAX_ROWS` | 2000 | Rows per bulk upload / Sheet import (the bulk routes accept 5MB bodies). |

The shutdown values must fit inside the platform's kill window: the defaults fit the
usual 30s. On ECS raise them together with `stopTimeout` (Option B above); on Render a
longer drain needs a longer shutdown delay on the service (`maxShutdownDelaySeconds` --
confirm the setting and its limit in Render's docs before relying on it).

`server/src/prisma.ts` appends `connection_limit=20&pool_timeout=20` to `DATABASE_URL`
unless it already sets `connection_limit` -- with 16-32+ leads in flight, Prisma's default pool
(~2×CPU+1) times out under that many concurrent completions.

**Tuning it.** Never more than one backend per database (see "One replica only").
The default is 16 (decided 2026-10-06): about what a 512 MB enrichment instance can
hold -- at 0.1 CPU (Render free) CPU is the cap there, so 32 gains nothing on free and
risks out-of-memory restarts. Run 100 real leads at 16 and compare against a run at 8
(set the env var on both services); keep it only if it passes all of the checks below.
On a 2 GB instance try 32, then 48 and 64, the same way:

- average `enrichedFieldCount` (EnrichmentRun) within 5% of baseline;
- On Hold rate (timeout/system_error) within 2 points;
- LinkedIn complete-profile rate not clearly below baseline;
- no sustained 429s in the logs (Tavily, Groq, Claude, Bright Data);
- `executionTimeMs` and `parallel_wait_ms` p50 not rising -- if they rise, Parallel is
  queuing us and more concurrency buys nothing;
- Python memory under 75%; Parallel runs created = leads.

Record the result here.

## Known follow-ups

Deliberately **not** changed as part of containerizing:

- **`pandas` and `openpyxl`** are in `requirements.txt` but imported nowhere; dropping
  them would cut roughly 150–250MB, but it changes what Render builds too.
- **`dist/` contains compiled test files** — `tsconfig.json` has no `exclude`.
