# G3 backend: one image, two processes (Node API + Python enrichment).
#
# Build from the REPO ROOT, not from server/ or enrichment_pipeline/:
#   docker build -t g3-backend .
#
# Deploying to Render/AWS from an arm64 Mac needs an explicit platform, or
# the image gets arm64 Prisma engines and dies on its first query:
#   docker buildx build --platform linux/amd64 -t g3-backend .
#
# See docs/DOCKER_DEPLOY.md.

# ---------------------------------------------------------------------------
# Stage 1: build the Node server (tsc -> dist/, plus the Prisma client)
# ---------------------------------------------------------------------------
# Debian, not Alpine: Prisma's query engine links against glibc+OpenSSL, and
# the musl variants are a recurring source of "engine not found" failures.
FROM node:20-bookworm-slim AS builder

# openssl is needed HERE, not just at runtime: `prisma generate` shells out
# to `openssl version -v` to pick which engine to download, and silently
# mis-detects (yielding openssl-1.1.x engines that fail to load) when the
# binary is absent. node:20-bookworm-slim does not ship it.
RUN apt-get update && apt-get install -y --no-install-recommends \
      openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# @mermaid-js/mermaid-cli is a devDependency that pulls Puppeteer, which
# downloads ~170MB of Chromium on install. It is a docs tool, never used at
# runtime. Both spellings are set because the variable was renamed across
# the Puppeteer versions that mermaid-cli 11 spans.
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    npm_config_fund=false \
    npm_config_audit=false

WORKDIR /app/server

# Manifests first so `npm ci` is cached independently of source edits.
COPY server/package.json server/package-lock.json server/.npmrc ./
RUN npm ci

COPY server/tsconfig.json ./
COPY server/prisma ./prisma
COPY server/src ./src

# ORDER IS LOAD-BEARING: `prisma generate` must run BEFORE `tsc`. Fourteen
# non-test source files import types from "@prisma/client" (Lead,
# EnrichmentTier, KpiConfig, ...) under strict:true; until the client is
# generated those resolve to an empty stub and the build fails. This matches
# the order render.yaml already uses.
RUN npx prisma generate
RUN npm run build

# .npmrc MUST be deleted before pruning. It sets production=false, which npm
# resolves into its *include* list, and include beats omit -- so with the
# file present `npm prune --omit=dev` is a silent no-op that ships
# typescript, ts-node-dev and the whole mermaid-cli/Puppeteer tree into the
# runtime image. Verified: `npm config --omit=dev get omit` returns empty
# inside server/ and "dev" anywhere else.
#
# The two `test` lines turn that silent regression into a build failure.
# Keep them.
# Assert on the PACKAGE path, not the scope directory: npm removes
# @mermaid-js/mermaid-cli but leaves an empty node_modules/@mermaid-js
# behind, so `test ! -d node_modules/@mermaid-js` fails on a perfectly
# good prune.
RUN rm -f .npmrc \
 && npm prune --omit=dev \
 && test ! -e node_modules/typescript \
 && test ! -e node_modules/@mermaid-js/mermaid-cli \
 && test ! -e node_modules/ts-node-dev \
 && test ! -e node_modules/prisma-erd-generator \
 && test -x node_modules/.bin/prisma \
 && test -d node_modules/.prisma/client

# Fail the build here rather than at runtime if the engine for the target
# platform is missing (the classic arm64-built-for-amd64 mistake).
RUN ls node_modules/.prisma/client/libquery_engine-*.so.node

# ---------------------------------------------------------------------------
# Stage 2: runtime -- Node 20 + Python 3.11, both processes, non-root
# ---------------------------------------------------------------------------
FROM node:20-bookworm-slim AS runtime

# Single layer, no recommends, lists cleaned in the same RUN so they never
# reach a committed layer. python3 on bookworm is 3.11. tini is a real init
# (see ENTRYPOINT). curl is used by start.sh's readiness gate and by
# HEALTHCHECK.
# procps earns its ~1MB: without it the image has no ps/pgrep/pkill and not
# even /bin/kill, so the documented "is python running / restart it" checks
# in docs/DOCKER_DEPLOY.md cannot be run against a misbehaving container.
# Scanning /proc by hand instead is easy to get subtly wrong -- a naive
# `grep` for the command line matches the grep process itself.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-venv \
      openssl ca-certificates curl tini procps \
 && rm -rf /var/lib/apt/lists/*

# --- runtime environment -------------------------------------------------
# PYTHONUNBUFFERED is mandatory, not hygiene: logger.py writes to stdout,
# which is block-buffered when not a TTY, so on a hard kill you lose exactly
# the log lines covering the incident.
#
# PYTHONDONTWRITEBYTECODE: the source tree is root-owned and the app user
# cannot create __pycache__, so without this CPython retries and fails that
# write on every import of every start.
#
# TZ=UTC is pinned deliberately. The 9 cron jobs pass no timezone argument,
# so they follow container-local time; Render is UTC today, so pinning
# preserves current behaviour and stops a future base-image change silently
# moving the 02:00/08:00/09:00 jobs.
#
# CHECKPOINT_DISABLE stops the Prisma CLI making an outbound version-check
# call on every container start -- latency and a failure surface on the boot
# path, for nothing.
ENV NODE_ENV=production \
    PORT=5001 \
    ENRICHMENT_PORT=8001 \
    ENRICHMENT_SERVICE_URL=http://127.0.0.1:8001 \
    KEEPALIVE_ENABLED=false \
    TZ=UTC \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    CHECKPOINT_DISABLE=1 \
    PRISMA_HIDE_UPDATE_MESSAGE=1 \
    HOME=/home/app \
    PATH=/opt/venv/bin:$PATH

# A real home directory matters: Docker does not read /etc/passwd for HOME,
# so under USER without an explicit ENV HOME it would be "/", and npm/Prisma
# would try to create /.npm and fail with EACCES.
RUN useradd --create-home --home-dir /home/app --shell /usr/sbin/nologin --uid 10001 app

# --- Python deps ---------------------------------------------------------
# requirements.txt alone first, so editing Python source does not bust the
# pip layer. --only-binary=:all: makes a missing wheel fail loudly at build
# time instead of silently falling back to an sdist that needs a compiler --
# which under QEMU emulation would be catastrophically slow.
COPY enrichment_pipeline/requirements.txt /app/enrichment_pipeline/requirements.txt
RUN python3 -m venv /opt/venv \
 && /opt/venv/bin/pip install --no-cache-dir --upgrade pip \
 && /opt/venv/bin/pip install --no-cache-dir --only-binary=:all: \
      -r /app/enrichment_pipeline/requirements.txt

# --- application code ----------------------------------------------------
WORKDIR /app

# Only what each process actually needs at runtime. Notably NOT server/src,
# NOT the .npmrc, and from prisma/ only the schema and migrations that
# `migrate deploy` reads (seed.ts and ERD.pdf are excluded in .dockerignore).
COPY --from=builder --chown=app:app /app/server/dist          /app/server/dist
COPY --from=builder --chown=app:app /app/server/node_modules  /app/server/node_modules
COPY --from=builder --chown=app:app /app/server/package.json  /app/server/package.json
COPY --from=builder --chown=app:app /app/server/prisma        /app/server/prisma

COPY --chown=app:app enrichment_pipeline /app/enrichment_pipeline

# COPY preserves the source file mode, and the exec bit on a file authored
# on macOS is easy to lose -- which would surface as "permission denied" at
# container start, after a long build. Set it explicitly.
COPY --chmod=0755 docker/start.sh /app/docker/start.sh

# Defence in depth against a secrets file slipping past .dockerignore. If
# enrichment_pipeline/.env were ever baked in, python-dotenv would silently
# load it (it resolves relative to config.py's own directory, NOT the working
# directory, so no choice of CWD protects against this) and any variable the
# host forgot to set would quietly inherit a stale dev value.
RUN test ! -e /app/enrichment_pipeline/.env \
 && test ! -e /app/server/.env \
 && echo "verified: no .env baked into image"

USER app

EXPOSE 5001

# start-period must exceed the time `prisma migrate deploy` needs to walk 27
# migrations before Node ever listens. Shell form so ${PORT} expands at
# runtime rather than build time.
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT:-5001}/health" || exit 1

# tini as PID 1: bash ignores signals with default dispositions when it is
# PID 1, which makes shutdown behaviour confusing, and uvicorn/node
# grandchildren can orphan. -g forwards signals to the whole process group.
# Exec form is required -- shell form would wrap this in `/bin/sh -c` and
# break signal delivery.
ENTRYPOINT ["/usr/bin/tini", "-g", "--", "/app/docker/start.sh"]
