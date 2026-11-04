# A-Health Unified setup on Linux

This repository contains the current Unified Staff Web, Patient Mobile source, and backend services. The legacy standalone web portals are not part of this repository.

## Requirements

- Ubuntu 22.04+ (or another Linux distribution with the same tools)
- Git, curl, build-essential
- Node.js 22
- pnpm 10.34.4
- PostgreSQL 17, or Docker Engine with Compose v2

## Clone and install

```bash
git clone https://github.com/aheathInc/AHP.git
cd AHP
git checkout main
corepack enable
corepack prepare pnpm@10.34.4 --activate
pnpm install --frozen-lockfile
```

Confirm the unified snapshot:

```bash
git log -1 --oneline
test -d apps/staff-web && test -d apps/patient-mobile
test ! -d apps/analytics && test ! -d apps/doctor-admin && test ! -d apps/admin
```

## Configure local environment

```bash
cp .env.example .env
sed -i "s/replace-with-local-password/$(openssl rand -hex 24)/g" .env
sed -i "s/replace-with-at-least-32-random-local-characters/$(openssl rand -hex 32)/g" .env
sed -i "s/replace-with-at-least-16-random-local-characters/$(openssl rand -hex 16)/g" .env
```

Keep `.env` private. It is ignored by Git.

## Start PostgreSQL and migrate

With Docker:

```bash
docker compose -f docker-compose.dev.yml up -d postgres
pnpm --filter @a-health/database exec prisma migrate deploy
```

With a native PostgreSQL installation, create database `ahealth_dev` and user `ahealth`, then ensure the `DATABASE_URL` in `.env` points to that database.

## Start the unified web app

```bash
pnpm --filter a-health-web dev
```

Open `http://localhost:3000/login`. The unified routes are:

- Doctor: `http://localhost:3000/doctor`
- Operations Admin: `http://localhost:3000/admin/dashboard`
- Analytics: `http://localhost:3000/analytics/dashboard`

Backend services must be running for login and data screens. Start the required services from separate terminals with `pnpm --filter @a-health/<service> dev`, using the service URLs in `.env`. Do not use the removed legacy ports 3100, 3200, or 3300.

## Stop

```bash
docker compose -f docker-compose.dev.yml down
```
