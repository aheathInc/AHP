# CI and release readiness

The tracked `.github/workflows/ci.yml` runs on main pushes, pull requests and manual dispatch. `Release verification` succeeds only when all dependency jobs succeed. Configure this check as required in repository branch protection through the repository owner; the workflow does not configure branch rules itself.

## Gates

- Locked pnpm dependencies, Prisma schema validation, API lint and generated-contract freshness.
- Staff Web TypeScript, HTTP/workflow unit tests, an isolated production build and production-server HTTP smoke checks. Smoke checks cover login availability, unauthenticated workspace redirects, JSON BFF authentication errors, cross-origin write rejection and secure CSRF cookie attributes. Authenticated end-to-end acceptance remains separate.
- TypeScript and every backend test file across 25 services in eight groups. Each file receives a fresh database inside a newly provisioned PostgreSQL cluster. No incoming DATABASE_URL is used. Zero executed tests or skipped backend cases fail the runner. Research portal and warehouse database suites are explicitly enabled against disposable targets.
- Pinned Flutter SDK, enforced dependency lock, analysis, complete unit/widget suite and an Android debug APK build using the hosted runner toolchain. Existing analyzer info-level findings remain visible; warnings and errors fail. Live/device tests retain their own opt-in requirements and skips must be reviewed.
- Apply all migrations twice and verify a synthetic backup restored to a separate database. This checks migration replay and preservation of linked synthetic rows and migration history. Production recovery drills, encryption, retention, point-in-time recovery and ledger acceptance remain operational requirements.

Actions and the Flutter SDK are pinned to revisions. Job tokens have read-only repository contents access. Test credentials are ephemeral. Backend and migration evidence and the debug APK are retained for seven days. Evidence upload contains synthetic test output; source secrets, database dumps and private environment files must never be uploaded.

## Local verification

From the repository root, after locked dependency installation and Prisma client generation:

```sh
bash setup-ci.sh
python3 scripts/ci/backend-tests.py --docker
python3 scripts/ci/check-migrations.py --docker
node scripts/ci/check-web.mjs
node scripts/ci/smoke-web.mjs
```

Docker mode requires Linux host networking and Docker access; it binds PostgreSQL only to loopback on a randomly chosen non-5432 port. Without `--docker`, the backend/migration helpers use installed PostgreSQL server tools and still create their own cluster. They never reuse the development database. Evidence stays in ignored `.local/ci-evidence/`; the helpers remove their own cluster at completion. A killed process may require cleanup of its uniquely named disposable container.

`--services auth patient`, `--match enrollment.test.ts` and `--evidence-dir .local/ci-evidence/recheck` support focused backend rechecks. A missing test match fails. The production web build defaults to `.next-readiness`, avoiding the running development build. `AHP_NEXT_DIST_DIR=.next-ci` is used by CI. Backend URLs point to an unused loopback port during build/smoke to prevent dependence on local live services.

## Evidence and remaining acceptance

Local verification completed during this change: production web build and security smoke, seven HTTP/web unit tests, 239 Flutter tests passed with 13 live/device-dependent skips, and a 44-migration synthetic backup/restore rehearsal. Flutter analysis had zero errors/warnings and 182 informational findings; API lint had 42 warnings. These are explicit remaining cleanup items, not zero-warning claims.

The first complete backend run exposed stale test fixtures/assertions in education, follow-up and notifications, and a registration simulation restricted to the development database. Those failures were corrected and rechecked; simulation in a test database requires the explicit isolation acknowledgement and a verified database identity. Production simulation remains disabled. CI results on the actual pushed commit provide the final fresh integrated verdict.

A debug APK is a development artifact. Its default API address targets the Android emulator; physical-device or production builds need the reachable gateway configured. It is not a signed store release or evidence of physical-device acceptance. No local Android SDK license agreement is accepted by these scripts. The hosted build uses the runner's provisioned Android toolchain.

Still required before claiming a production release: an identified hosting target/domain, deployed HTTPS gateway and service configuration, real payment/package decisions and provider integrations, approved Android signing, physical-device acceptance, authenticated clinical end-to-end and accessibility review, and operational monitoring/backup/incident procedures. No production environment has been deployed by this CI workflow. See [the release runbook](PRODUCTION-RELEASE-RUNBOOK.md).
