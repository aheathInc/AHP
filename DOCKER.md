# Docker deployment

This repository has a development backend stack and a frontend deployment layer. Docker Compose runs PostgreSQL, the backend services, and all three Next.js applications without changing the application stack.

## Prerequisites

- Docker Engine with Compose v2
- At least 4 GB of available memory

## Start the full stack

From the repository root:

```bash
docker compose -f docker-compose.dev.yml build --parallel
docker compose -f docker-compose.dev.yml -f docker-compose.frontend.dev.yml build --parallel
docker compose -f docker-compose.dev.yml -f docker-compose.frontend.dev.yml up -d --no-build
```

The first build installs the workspace dependencies and creates production Next.js images. The Dockerfiles use a persistent BuildKit pnpm cache, so interrupted or later builds do not need to download the entire workspace again. Backend services stay private inside the Compose network, while the frontend containers reach them through Docker service names.

Build in two stages so one failed frontend download does not cancel the entire backend build:

```bash
docker compose -f docker-compose.dev.yml build --parallel
docker compose -f docker-compose.dev.yml -f docker-compose.frontend.dev.yml build --parallel
```

Then start the already-built images:

```bash
docker compose -f docker-compose.dev.yml -f docker-compose.frontend.dev.yml up -d --no-build
```

Apply database migrations before using the application:

```bash
docker compose -f docker-compose.dev.yml -f docker-compose.frontend.dev.yml run --rm \
  auth sh -lc 'cd /repo && pnpm --filter @a-health/database exec prisma migrate deploy'
```

The migration command runs inside the backend image and uses the Compose database hostname `postgres`.

The frontend overlay publishes PostgreSQL on host port `15432` so it can coexist with a system PostgreSQL service. Backend containers still use the internal `postgres:5432` address.

The database image is PostgreSQL 16, matching the existing development volume format and the project documentation. Do not remove the `ahealth_pg_data` volume unless you intentionally want to erase the development database.

Open the applications:

- Clinician dashboard: http://localhost:3100
- Operations console: http://localhost:3200
- Analytics portal: http://localhost:3300

For the patient mobile app, use the LAN API base URL `http://10.111.165.88:8080/api/v1`. The API edge routes authenticated requests to the private backend services; do not configure the phone to call ports `4001`–`4025` directly.

For a phone on the same Wi-Fi, open `http://10.111.165.88:3100`, `http://10.111.165.88:3200`, or `http://10.111.165.88:3300`. The three frontend ports are bound to all host interfaces, and backend ports remain private inside Docker. This is LAN access, not internet exposure; do not forward these ports through your router. If the computer receives a different LAN IP, export `DOCTOR_NEXTAUTH_URL`, `ADMIN_NEXTAUTH_URL`, and `ANALYTICS_NEXTAUTH_URL` with the new address before recreating the frontend containers.

Check status and logs:

```bash
docker compose -f docker-compose.dev.yml -f docker-compose.frontend.dev.yml ps
docker compose -f docker-compose.dev.yml -f docker-compose.frontend.dev.yml logs -f doctor-admin
```

Stop the stack:

```bash
docker compose -f docker-compose.dev.yml -f docker-compose.frontend.dev.yml down
```

This is a development deployment. Replace the default database password, JWT secret, and NextAuth secret before exposing it beyond the local machine.

## Hosted AHP preparation (no cloud payment required)

`deploy/compose.yml` is a separate hosting definition for the unified Staff Web,
25 backend service definitions and a Caddy HTTPS edge. It uses an external managed
PostgreSQL database. The development Compose files above remain development-only.
Preparing files locally does not provision a Droplet, database, domain or public URL.

Generate and inspect the configuration:

```sh
python3 deploy/prepare.py
python3 -m unittest discover -s deploy -p 'test_configuration.py' -v
python3 deploy/configure.py init
python3 deploy/configure.py check
```

The `Hosting package` GitHub workflow also builds both runtime images and exercises
Caddy routing against synthetic loopback backends. It creates no cloud resources and
deploys nothing. Locally, `python3 deploy/test_proxy.py` requires the pinned Caddy
image in the Docker cache.

Python 3, PyYAML and Docker Compose v2 are needed for generation and configuration
tests. `init` creates ignored `deploy/.env.production` with mode 600 and four independent
random secrets. It refuses to overwrite an existing file and never prints its values.
`check` is offline: it reports missing settings by name and does not connect to a
server/database. It is expected to fail until real configuration is supplied.

### Server configuration when the account is activated

1. Provision the selected Linux server and managed PostgreSQL in the approved region.
   Server sizing is an initial estimate; it has not been load-tested. A single web/API
   host and a single-node database are not a highly available hospital deployment.
2. Create two owned DNS names, one for Staff Web and one for API. Put them in
   `AHP_WEB_HOST` and `AHP_API_HOST` without schemes or paths. Point their DNS records
   at the server. Configure `ACME_EMAIL`; expose TCP 80/443 through the cloud firewall
   and restrict SSH to the operator. Backend and PostgreSQL ports are not published.
3. Create separate database migration-owner and runtime roles. Download the database
   provider's CA to `deploy/database-ca.crt`. Set both database URLs for the **same**
   production database with `sslmode=verify-full`,
   `sslrootcert=/run/config/database-ca.crt` and `schema=public`. Start runtime pools
   with `connection_limit=2`, allowing for all services plus messaging connections;
   monitor usage and size the database before growing pools. URL-encode credentials.
4. Configure approved live Africa's Talking credentials and sender ID for Auth/OTP and
   notifications. Production rejects console/sandbox OTP. A working SMS provider is
   a separate launch dependency; hosting payment does not activate SMS delivery.
5. Keep optional `payment`, `ai`, `research` and `gateway` profiles off until reviewed.
   Payment requires a live Flutterwave account, credentials and explicit
   `PAYMENTS_LIVE_ENABLED=true`; starting its profile may enable real charges and
   needs the owner's separate approval. With that profile off, payment-dependent
   registration/checkout cannot complete. This is not a public patient launch yet.
   AI requires its own reviewed HTTPS provider/model. Research portal/warehouse remain
   disabled in this baseline even if the research service profile is started. USSD
   needs telecom integration; the gateway service is not the general API router.
6. Set `AHP_IMAGE_TAG` to the reviewed commit, provision secrets on the server, then run
   `python3 deploy/configure.py check`. Add `--profile payment` or `--profile ai` to
   validate those optional credentials. Production secrets belong on the server or in
   its secret manager; do not commit/upload local environment files or use them as
   Docker build arguments. Single-quote literal values containing `$` in Compose env
   files. Do not print a rendered Compose configuration containing secrets.

After the release prerequisites, backup and approved migration window in
[the release runbook](docs/PRODUCTION-RELEASE-RUNBOOK.md) are satisfied, the server
commands are:

```sh
# Run from the repository root. These commands are for the configured server later.
docker compose --env-file deploy/.env.production -f deploy/compose.yml config --quiet
docker compose --env-file deploy/.env.production -f deploy/compose.yml build auth web
# Explicit operation; startup does not migrate automatically.
docker compose --env-file deploy/.env.production -f deploy/compose.yml run --rm migrate
```

After migrations, run `deploy/grant-runtime.sql` with psql as the migration owner,
passing `-v runtime_role=<runtime-role> -v migration_role=<migration-role>`. Supply
that role's database connection through a protected PostgreSQL connection/service
file rather than a command-line password. Runtime needs table/sequence privileges;
it must not own the schema or have superuser/role-creation privileges. Existing audit
immutability triggers still apply. Apply grants again after future migrations and
validate the ledger as required by the release runbook.

```sh
docker compose --env-file deploy/.env.production -f deploy/compose.yml up -d --no-build
docker compose --env-file deploy/.env.production -f deploy/compose.yml ps
```

Only Caddy publishes ports. It routes API paths without removing their prefixes,
including pharmacy prescription handoffs, message threads and laboratory orders,
and supports WebSocket proxying. Unknown API paths return 404. Request access logs
are not enabled at the edge. Certificates persist in named volumes. Optional-service
routes fail unavailable while their profiles are off; no simulated service replaces them.
The web image runs `next start` as a non-root user. Backend workspace packages export
TypeScript and run through their existing `tsx` loader, without a watcher. Runtime
filesystems are read-only with limited temporary/cache mounts. The shared workspace
image includes build tooling; a smaller image is a future optimization, not a
condition for this preparation.

Before public access, confirm HTTPS/DNS, real-device API communication, authenticated
clinical flows, provider outcomes, scheduled protected backups and tested restore,
alerts and incident contacts. Production launch and real payments remain separate
from this offline hosting preparation. Build and run Flutter with the owned HTTPS
API hostname through `--dart-define=API_GATEWAY_URL=https://<api-host>` after it is live.

Reference behavior: [Caddy reverse proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy),
[Compose environment precedence](https://docs.docker.com/compose/how-tos/environment-variables/envvars-precedence/),
[Docker build secrets](https://docs.docker.com/build/building/secrets/).
