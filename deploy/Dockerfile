# syntax=docker/dockerfile:1.7
FROM node:22-bookworm-slim AS workspace
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/* && corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY packages ./packages
COPY services ./services
COPY apps/staff-web ./apps/staff-web
RUN --mount=type=cache,id=ahp-hosting-pnpm,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && pnpm install --frozen-lockfile
RUN DATABASE_URL=postgresql://unused@127.0.0.1:9/build_only pnpm --filter @a-health/database generate

# Workspace packages export TypeScript source; use the existing tsx runtime,
# without a watcher or a development server. CI separately checks all services.
FROM workspace AS backend
ENV NODE_ENV=production
USER node
CMD ["node", "--version"]

FROM workspace AS web-build
COPY scripts/ci/check-web.mjs ./scripts/ci/check-web.mjs
ENV AHP_NEXT_DIST_DIR=.next
RUN node scripts/ci/check-web.mjs

FROM workspace AS web
COPY --from=web-build /repo/apps/staff-web/.next /repo/apps/staff-web/.next
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
WORKDIR /repo/apps/staff-web
USER node
CMD ["node", "node_modules/next/dist/bin/next", "start", "-H", "0.0.0.0", "-p", "3000"]
