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

- `pollInFlight` (`server/src/jobs/enrichment.job.ts:59`) is an **in-memory** boolean
  that caps enrichment at `POLL_CONCURRENCY = 8`. N replicas means N×8 concurrent calls
  against a Python service whose own bulkheads assume 8.
- The 9 cron jobs are unguarded, so every digest, reminder and Slack escalation fires
  once per replica.

App Runner: min = max = 1. ECS: `desiredCount: 1` **and** `maximumPercent: 100`, so a
rolling deploy cannot briefly run two.

### Health check

Path `/health`, and allow a generous start period — `prisma migrate deploy` walks 27
migrations before Node listens. 120s is the configured default.

### Never deploy mid-batch

A deploy kills in-flight enrichment. A single lead can take ~70 minutes, and the
platform's shutdown grace (~30s on Render) is nowhere near that. The lead is not lost —
it sits in `IN_PROGRESS` until `stallOverdueEnrichments` sweeps it after
`STALL_TIMEOUT_MS` (**80 minutes**, `enrichment.job.ts:553`) — but it is 80 minutes of
nothing happening. Check for active enrichment before deploying.

### Memory: 2GB minimum

Python can hold up to 40 concurrent enrichment threads. 512MB will OOM.

Related, and worth knowing before your first real load: the **bulk upload route has no
concurrency cap**. `lead.routes.ts:644-646` fires `setImmediate(() =>
enrichLeadById(...))` per CSV row, with none of the throttling the cron poller uses. A
200-row import starts 200 concurrent 70-minute calls. **Do not make a large bulk upload
the first thing you do on a new host.**

### Environment variables the image already sets

Platform environment **overrides** the image's `ENV`. Do not set these by hand:

```
NODE_ENV  PORT  ENRICHMENT_PORT  ENRICHMENT_SERVICE_URL  KEEPALIVE_*  TZ
```

A leftover `ENRICHMENT_SERVICE_URL` in a Render dashboard or ECS task definition is the
single easiest way to break this deployment: Node keeps calling the old public Python
service, and the failure looks like a network error rather than a config mistake.

If you ever must override it: **no trailing slash.** `enrichment.job.ts:141` builds
`${url}/enrich` by plain concatenation.

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
3. Service: `desiredCount: 1`, `maximumPercent: 100`, `minimumHealthyPercent: 0`.
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

## Known follow-ups

Deliberately **not** changed as part of containerizing:

- **No SIGTERM handler in Node** (`server/src/index.ts`). On stop, Node dies without
  `server.close()` or `prisma.$disconnect()`. Pre-existing; causes a stuck-lead window
  recovered by the 80-minute stall sweep, not data loss.
- **Trailing-slash bug** in `enrichment.job.ts:141` — unlike the keepalive code, it does
  not normalise the URL.
- **Uncapped bulk-upload fan-out** (`lead.routes.ts:644-646`) — the biggest OOM risk.
- **`pandas` and `openpyxl`** are in `requirements.txt` but imported nowhere; dropping
  them would cut roughly 150–250MB, but it changes what Render builds too.
- **`dist/` contains compiled test files** — `tsconfig.json` has no `exclude`.
