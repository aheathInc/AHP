# Family services and subscription packages

## Staff and patient workflows

Clinicians use `/doctor/families` to search only the families currently assigned to their verified account. Platform administrators use `/admin/families` for the scoped directory, separate GP / OB-GYN assignment, package terms and enrollment review. Family details contain membership and care-team metadata, not another person's clinical records.

The patient app Family screen can create a family group, link an owned or legally guarded dependant and open the package catalogue. Creating a family does not allocate a paid tier. Only the family head can request a change, after reviewing published benefits, exclusions, billing period and price. The app shows request history and decisions. Families without a package can still manage their family directory.

A package request records the original terms as an immutable snapshot. Each family can have one pending request. Durable UUIDs deduplicate uncertain retries. An active platform administrator reviews eligibility and records a non-clinical reason to approve or decline. Approval requires unchanged package and family revisions; changed terms require declining the old request and submitting a fresh one. This preserves the terms actually reviewed by the applicant.

## Package catalogue and financial boundaries

`none`, `family_basic` and `family_plus` retain the existing subscription enum. New catalogue rows start with no published price and requests closed. Basic and Plus have no invented clinical benefits. The service operator must publish approved descriptions, included services, exclusions, TZS pricing and a monthly or annual billing period before opening requests. Price storage uses hundredths of TZS; the UI accepts ordinary TZS amounts.

Package approval is an administrative allocation, not evidence of payment. This feature does not collect money, issue invoices, schedule recurring charges, calculate pro-rata refunds, enforce paid clinical entitlements or promise unlimited care. Existing payment workflows remain separate. Clinical access always follows the clinical service's consent and authorization rules. No production prices have been invented or deployed.

## Authorization and consistency

- Patient heads can manage their family and link only profiles they own or legally guard. Arbitrary adult profile linking is rejected; adult invitations/consent are not implemented by this feature.
- Current active account roles are checked in the database. Assigned clinicians must remain verified. Unassigned clinicians cannot read other families through the directory or detail API.
- Administrators select active verified clinicians with the corresponding `general_practice` or `obstetrics_gynaecology` specialty. These must be separate clinicians. Null explicitly clears a slot; an omitted field retains it.
- Family and clinician rows are locked during assignment. Capacity checks, load release/claim, membership changes, package decisions and required audit writes are transactional. Stale family/request/package versions fail with a conflict.
- Family responses are private and non-cacheable. Read failures clear unverified client data. Administrative notes must omit patient clinical details.

## Deployment and verification

Apply `20261112210000_family_service_packages`, `20261112211000_family_package_terms_snapshot` and `20261112212000_family_package_request_index`, regenerate Prisma, then deploy Families, staff web and the patient app together. Assignment HTTP requests now require `base_version`. Family creation only accepts `subscription_tier: none`; use the request/review endpoints for changes. Existing stored family tiers remain intact; they are not reclassified as paid subscriptions.

The local migration runner creates a private database backup and targets only the owned development database on port 55432. Tests run in a separate disposable PostgreSQL cluster. Regression coverage includes family ownership, concurrent capacity, scoped clinician panels, durable request retries, changed terms, repeated review, inactive accounts and rollback when the mandatory audit fails.

The opt-in browser acceptance test `apps/staff-web/tests/e2e/family-service-packages.spec.ts` uses synthetic accounts, exercises the real staff BFF and runs `apps/patient-mobile/test/live_family_packages_test.dart` against the local services. Temporary synthetic package terms are restored in a finally block. Screenshots cover desktop, narrow web and the Flutter app. This is not physical-device or production acceptance.

Before production, the operator must approve actual package prices/benefits, billing integration, eligibility and renewal/cancellation policy, adult invitation rules and a staffed enrollment review process.

Local acceptance on 12 November 2026: all 15 isolated database tests, the Firefox staff workflow and the live Flutter family/package test passed. The browser run verified administrative allocation after the patient request and restored the original catalogue terms. No physical device was connected during acceptance.
