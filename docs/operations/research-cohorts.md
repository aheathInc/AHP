# Research cohort workspace

The researcher portal at `/analytics/research` now supports named, persistent aggregate cohort definitions. Researchers can load published filter choices, save a definition against the project's exact approved release, edit it with version checks, run it again, and archive it with explicit confirmation. The limit is 50 active and 100 total definitions per project. Names are unique within a project, including archived names. Definitions store filters and release references; they do not store result cells or patient records.

Each workspace load, query, save, update and rerun rechecks the current account, verified researcher profile, project ownership, project and ethics expiry, collection, release and source authorization. A changed project release requires a new definition. Concurrent edits return 409 rather than overwriting each other. Owners can archive definitions after project expiry without receiving data. All committed cohort operations are audited within the same transaction. Audit metadata excludes definition names and filter text.

Results include the applied filters, completion timestamp in UTC, release version, content hash, disclosure threshold and, where applicable, saved definition version. Search, sort and pagination act only on already-published cells. The interface does not sum overlapping cells into a unique patient total or disclose suppressed counts. Filter options come exclusively from the same published release.

Reviewed export requests use the exact result's filters, release ID and hash. Editing filters disables export until the analysis runs again. Searching or sorting the displayed table does not change export scope. Existing independent output review and live authorization checks still apply to downloads. Direct API consumers may supply `release_id` and `release_hash` on aggregate export requests to reject a stale displayed release; legacy requests remain compatible.

Project listings now include title/purpose search, effective expiry filtering and readiness details for identity, required scanned protocol/ethics/controller evidence, governance status and authorization dates. Search covers the up to 100 recent projects loaded by the existing bootstrap endpoint. Readiness details are informational; the backend remains authoritative for actual access.

## Deployment and verification

Apply migration `20261116210000_research_saved_cohorts` before deploying the updated research service, then regenerate Prisma. Enable the portal with `RESEARCH_PORTAL_ENABLED=true` and configure distinct 32-byte base64 `RESEARCH_ENCRYPTION_KEY` and `RESEARCH_LINKAGE_KEY` secrets. Preserve existing keys whenever updating a deployment; rotating them without a migration would invalidate encrypted records and linkage. Document upload continues to require the existing configured malware scanner. These cohort features do not enable ingestion or provision an OMOP warehouse.

The local development portal is enabled with generated private keys and `RESEARCH_REAL_DATA_INGEST_ENABLED=false`. No keys belong in source control. Browser verification uses temporary synthetic accounts and released aggregate fixtures, which are removed afterward.

Run `python3 scripts/ci/backend-tests.py --docker --services research` against the runner's disposable databases, `node scripts/ci/check-web.mjs` for the isolated production build, and the API lint/generate scripts in `packages/api`. Saved-cohort database tests cover ownership, persistence, concurrency, expiry/revocation, release pinning, export provenance, archiving and filter validation. Existing OMOP and disclosure tests remain part of the research suite.
