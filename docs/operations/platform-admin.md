# Platform administration

The platform overview prioritizes emergency acknowledgements, escalated incidents and pending clinician reviews. Counts cover all matching database records, rather than a paginated sample. The snapshot includes its timestamp, environment and oldest outstanding work. It contains no patient identities or clinical text. Refresh is manual or once per minute while the tab is visible; it is not a guaranteed alerting or dispatch system. Disease surveillance remains under Health & Regional Insights.

Clinician verification supports name and licence search, status filters and cursor pagination. Administrators explicitly confirm credential review before approving, or supply an actionable rejection reason. Decisions carry the displayed record version, and conflicting decisions return HTTP 409. Licence searches are restricted to platform administrators; public directories remain limited to active, verified clinicians. Identity and licence evidence must still be checked through the organization's approved verification process.

Incident management supports status and severity filters and cursor pagination. The supported lifecycle is:

- Reported → Under investigation, with an investigation plan.
- Under investigation → Action taken, with a recorded action and outcome.
- Action taken → Closed, with an explicitly reviewed outcome; or back to investigation.
- Closed → Under investigation, with a reopening reason.

Only platform administrators may list or update reports. Updates use optimistic concurrency, and the status change and audit entry commit together. Audit metadata records the transition and version without duplicating investigation text. Anonymous reports retain no reporter identity. Notes are restricted governance information; operators should avoid unnecessary patient identifiers.

Account settings expose actual profile and account information, rather than simulated security controls. Unavailable services produce explicit recovery states instead of empty lists or zero counts. The improved pages support mobile layouts, keyboard focus and the existing light/dark themes.

These improvements establish more robust administration workflows. They do not constitute accreditation, regulatory certification, a clinical credential-verification service or a completed production deployment.

## Verification

Run the quality, surveillance and doctor suites against an isolated disposable database using `python3 scripts/ci/backend-tests.py --docker --services quality surveillance doctor`. Run `node scripts/ci/check-web.mjs` for the isolated production web build, and lint/regenerate the API contract using the scripts in `packages/api`.
