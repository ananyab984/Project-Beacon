#!/usr/bin/env bash
#
# Build the G3 backend image for BOTH CPU types and push it to a registry as
# one multi-architecture image.
#
#   linux/amd64  -> Intel / AMD servers (most EC2 types, default Fargate)
#   linux/arm64  -> ARM servers (AWS Graviton, Fargate ARM64, Apple Silicon)
#
# Whoever runs the image just pulls the tag; Docker / AWS automatically picks
# the half that matches the server's CPU. Nothing else changes between them.
#
# Usage (from the repo root):
#   docker/build-multiarch.sh <image>:<tag>
#
# Examples:
#   docker/build-multiarch.sh 123456789012.dkr.ecr.us-west-2.amazonaws.com/g3-backend:1.0.0
#   SMOKE_TEST=1 docker/build-multiarch.sh ghcr.io/global3io/g3-backend:1.0.0
#
# Options (environment variables):
#   PLATFORMS=linux/amd64,linux/arm64   which CPU types to build (default: both)
#   SMOKE_TEST=1                        after pushing, start each CPU type once
#                                       and check Node, Python and Prisma load
#   BUILDER=g3-multiarch                buildx builder name to create / reuse
#
# Why it must PUSH: a multi-architecture image is really two images plus an
# index that points at both. A single machine's local image store can't hold
# that as one tag, so it goes straight to a registry (ECR, GHCR, Docker Hub).
#
# Expect it to be slow on a laptop: the half that doesn't match your own CPU
# is built under emulation (on an Apple Silicon Mac that's the amd64 half,
# often 10-25 minutes). CI (.github/workflows/docker-multiarch.yml) is faster.

set -euo pipefail

IMAGE="${1:-}"
PLATFORMS="${PLATFORMS:-linux/amd64,linux/arm64}"
BUILDER="${BUILDER:-g3-multiarch}"

log() { echo "[build] $*"; }
die() { echo "[build] ERROR: $*" >&2; exit 1; }

[ -n "$IMAGE" ] || die "usage: docker/build-multiarch.sh <image>:<tag>   (e.g. <account>.dkr.ecr.<region>.amazonaws.com/g3-backend:1.0.0)"
case "$IMAGE" in
  *:*) ;;
  *) die "give the image an explicit tag, e.g. ${IMAGE}:1.0.0 (avoid relying on :latest)" ;;
esac

# Must run from the repo root: the Dockerfile copies server/ and enrichment_pipeline/.
[ -f Dockerfile ] && [ -d server ] && [ -d enrichment_pipeline ] \
  || die "run this from the repo root (where Dockerfile, server/ and enrichment_pipeline/ are)"

command -v docker >/dev/null || die "docker is not installed"
docker buildx version >/dev/null 2>&1 || die "docker buildx is not available (update Docker Desktop / install the buildx plugin)"

# The default "docker" builder can't build several platforms at once; a
# builder using the docker-container driver can. Create it once, reuse after.
if docker buildx inspect "$BUILDER" >/dev/null 2>&1; then
  docker buildx use "$BUILDER"
else
  log "creating buildx builder '$BUILDER'"
  docker buildx create --name "$BUILDER" --driver docker-container --use >/dev/null
fi
docker buildx inspect --bootstrap >/dev/null

# Log in to ECR automatically when the target is an ECR repository and the
# AWS CLI is available. For other registries, run `docker login` yourself first.
registry="${IMAGE%%/*}"
if [[ "$registry" == *.dkr.ecr.*.amazonaws.com ]]; then
  if command -v aws >/dev/null; then
    region="$(echo "$registry" | sed -E 's/.*\.dkr\.ecr\.([a-z0-9-]+)\.amazonaws\.com/\1/')"
    log "logging in to ECR ($region)"
    aws ecr get-login-password --region "$region" | docker login --username AWS --password-stdin "$registry" >/dev/null
  else
    log "AWS CLI not found; assuming you already ran 'docker login' for $registry"
  fi
fi

log "building $IMAGE for $PLATFORMS"
docker buildx build \
  --platform "$PLATFORMS" \
  --tag "$IMAGE" \
  --push \
  .

log "pushed. CPU types inside the image:"
docker buildx imagetools inspect "$IMAGE" | grep -E "Platform:" | grep -v "unknown/unknown" || true

if [ "${SMOKE_TEST:-0}" = "1" ]; then
  # Runs each CPU type once WITHOUT the normal startup script (which would
  # need real environment variables and a database). It only proves the
  # programs inside that half of the image load on that CPU.
  IFS=',' read -r -a plats <<< "$PLATFORMS"
  for plat in "${plats[@]}"; do
    log "smoke test: $plat"
    docker run --rm --platform "$plat" --entrypoint bash "$IMAGE" -c '
      set -e
      echo "  cpu:    $(uname -m)"
      echo "  node:   $(node --version)"
      echo "  python: $(/opt/venv/bin/python -c "import sys; print(sys.version.split()[0])")"
      /opt/venv/bin/python -c "import fastapi, uvicorn, pydantic, parallel" && echo "  python packages: ok"
      # prisma --version actually loads the query engine for THIS cpu, which is
      # the part that breaks when an image is built for the wrong architecture.
      cd /app/server && node_modules/.bin/prisma --version | grep -iE "query engine|^prisma " | sed "s/^/  /"
    '
  done
  log "smoke tests passed"
fi

log "done: $IMAGE"
