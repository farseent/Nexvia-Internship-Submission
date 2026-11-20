#!/usr/bin/env bash
# One-command local setup: env file, dependencies, infrastructure, Prisma client, migrations.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example"
fi

# Collaboration token keys (docs/DEPLOYMENT.md); an existing key is never replaced.
node scripts/generate-collab-keys.mjs --write

command -v pnpm >/dev/null || { echo "pnpm is required (corepack enable)"; exit 1; }
command -v docker >/dev/null || { echo "Docker is required for local PostgreSQL and Redis"; exit 1; }

pnpm install --frozen-lockfile
docker compose -f infra/docker-compose.yml up -d --wait

# Prisma reads DATABASE_URL from the environment.
set -a; . ./.env; set +a
pnpm run build:packages
pnpm run db:migrate:deploy

echo
echo "Ready. Start the services in separate terminals:"
echo "  pnpm dev:api    pnpm dev:collab    pnpm dev:web"
