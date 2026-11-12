# Professional network governance

The clinician network supports peer education and evidence discussion. Patient-specific handoffs belong in patient-authorized referrals or the named clinical collaboration workspace. Group membership and a confidentiality checkbox do not anonymize clinical text.

## Delivered workflow

Verified active clinicians explicitly join a group and choose in-app notifications. Search and All / My discussions / Unanswered filters run on the server before pagination. New discussions require an explicit publishing group, a subject, a contribution, a full preview and confidentiality/professional accuracy confirmation. Replies require a separate confirmation and support parent references.

Publication and reply UUIDs are durable database keys scoped to their authors. Uncertain retries return the existing record; changed payloads are rejected. Reads and writes recheck current membership. Hidden content returns a placeholder, including publication retries, and is excluded from feeds and notifications. Group responses never serialize care-thread identifiers. This does not detect identifiers typed into free text.

Members can report privacy, misinformation, conduct or spam concerns without entering additional patient details. Reports are deduplicated. The platform administrator queue provides restricted, audited access to original reported content and version-checked Hide / Dismiss decisions. Authors can withdraw their own posts or replies. Hiding retains original content for governance; it is not permanent erasure. Report decisions and content changes roll back if their audit write fails. A report alone does not hide content.

## Access and operations

- Clinicians: `/doctor/network`; individual discussion pages show members' replies and withdrawal/report actions.
- Active platform administrators: `/admin/professional-network`.
- Apply `20261112200000_professional_network_governance` before deploying the network service and staff web together. Existing posts remain intact. New HTTP publication/reply requests require `privacy_confirmed: true` and a durable `client_request_id` / `client_reply_id` UUID. Trusted internal legacy service calls remain separate from the HTTP contract.
- Set a staffed moderation rota, reporting escalation procedure, response targets and local records-retention policy before production use. The UI currently supplies in-app notifications, not emergency escalation or external alerts.
- Feeds refresh periodically while visible; threads support manual refresh. Already rendered text on another device cannot be remotely erased instantly. Fresh server reads/writes enforce membership and moderation state.

## Design references and limits

Professional conduct, confidentiality, indirect identification risk and evidence communication were informed by the [GMC guidance on using social media as a medical professional](https://www.gmc-uk.org/professional-standards/the-professional-standards/using-social-media-as-a-medical-professional/using-social-media-as-a-medical-professional). This UK guidance is a design reference, not a claim about Tanzanian law. Form labels, focus visibility, readable states and responsive layout use [WCAG 2.2](https://www.w3.org/TR/WCAG22/) as an accessibility reference. Neither reference establishes certification or full compliance; local regulatory review and a full accessibility audit remain necessary for any such claim.

The feature does not automatically anonymize text, verify medical claims, establish a clinical handoff or replace patient consent. Unsent drafts are not a persistent offline outbox.

## Verification

An isolated PostgreSQL test run covers 14 tests, including concurrent retries, payload conflicts, membership revocation, hidden-content replay, nested replies, report deduplication, role checks, version conflicts and audit rollback. The browser acceptance test uses newly created synthetic clinician/admin accounts and no patient records; it exercises actual web-to-service requests, a lost reply response, reporting and moderation. Local fixture and backup files are private and ignored by Git.

Run the browser test only against the owned local stack using `AHP_PROFESSIONAL_NETWORK_FIXTURE` and `apps/staff-web/tests/e2e/professional-network-governance.spec.ts`. No production deployment or physical-device acceptance is implied.
