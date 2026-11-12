# Emergency reliability and dispatch

The Tanzania patient app offers **112 — Emergency / Police**. This opens the phone dialer; it does not automatically call, connect AHP to a public control room, or guarantee an ambulance. The configured number was confirmed by the project owner. [TCRA](https://www.tcra.go.tz/faq/frequent-asked-questions-on-numbering) identifies 112 as Police.

## Patient experience

SOS is reachable before login and the 112 dialer remains available from the biometric lock screen and emergency toolbar. The patient explicitly requests GPS, sees its accuracy and capture time, or selects a map pin/manual coordinates. A country viewport is never submitted as a patient location. Callback number and landmark help an operator verify the incident.

The app distinguishes a recorded request, dispatcher acknowledgement, unit assignment, departure, arrival and closure. It displays the last successful refresh and does not invent an ETA. Offline reporting is not silently queued. An uncertain retry retains its client UUID; the server returns the same incident for the same owner and content. An authenticated user's encrypted recovery record is scoped to their account. Account changes clear the screen. A saved incident whose refresh fails blocks accidental creation of another request. Storage failure does not prevent reporting or conceal a confirmed receipt.

Anonymous reporting is supported, but protected recovery/status reads require an authorized signed-in account. Anonymous receipts are held in the current screen only. The dialer remains the fallback when internet reporting or recovery fails.

## Dispatcher workflow

The board queries active/closed incidents before pagination, orders explicit human priority before scale and age, and refreshes while visible. New incidents begin unassessed. An operator acknowledges and assesses priority; active incidents can be reassessed with a reason and current version. Membership/VIP status does not confer medical priority.

Dispatch requires an explicitly selected available unit and active receiving facility. Database row locks, a partial unique constraint and version checks prevent competing assignments and stale updates. Unit positions older than ten minutes are marked stale; stale coordinates do not receive a distance rank. Location proximity does not establish clinical suitability or road travel time.

Lifecycle transitions are constrained and resolution requires an outcome. Closing an incident does not automatically declare its crew available: the operator separately confirms readiness before release. Status records still require real radio/crew confirmation; the software cannot prove physical departure or hospital acceptance.

## Privacy and integration

Patient and guardian access is checked against current account state. Staff mutations require a currently active dispatcher/admin even on idempotency replay. Private handover/assessment notes stay staff-only. Closed patient incidents do not expose a vehicle's subsequent position. Consented context access and explicit reasoned break-glass access are audited. Context availability does not mean clinical context was transmitted to a hospital.

Report/history/audit and dispatch/history/audit writes are atomic. Polling the database-backed API is the source of truth; event delivery is best effort. Responses are marked no-store. Device alerts use a domain-separated HMAC, a five-minute timestamp window and server verification of the alert, patient and real coordinates. An unsigned request cannot impersonate device provenance. Deploy the updated Devices and Emergency services together with the same protected backend signing secret and synchronized clocks. Never distribute that secret to either app.

## Deployment and verification

Migration: `20261112150000_emergency_reliability`. Back up first and check for units assigned to multiple active incidents. The migration deliberately refuses conflicting historical assignments instead of deleting them. It was applied to the local development database after an isolated backup and zero-conflict preflight; production was not changed.

Automated coverage includes isolated PostgreSQL concurrency, authorization, rollback, recovery, private timeline, device attestation and priority tests; Flutter GPS/error/retry/account/lock-screen tests; and a real local patient API-to-Firefox dispatcher workflow with synthetic records through assignment, arrival, resolution and crew release. No test calls 112 or dispatches real transport. Physical-device/carrier acceptance remains outstanding.

The design draws on [WHO prehospital operational guidance](https://www.who.int/publications/9789240114067) and [WCAG 2.2](https://www.w3.org/TR/WCAG22/). This is not certification or a claim of full standards compliance. Production emergency operations still require locally approved clinical protocols, trained 24/7 staffing, verified crew/hospital communications, response-time monitoring, outage drills, abuse controls and physical-device acceptance.
