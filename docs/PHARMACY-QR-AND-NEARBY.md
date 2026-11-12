# Pharmacy QR and nearby medication availability

The existing prescription handoff now supports QR display in Patient App → medicines and camera scanning in Staff Web → `/pharmacy`. The QR contains only the existing 43-character random reference. No patient details, medication list, diagnosis, URL or authentication token is embedded. References remain hash-only at rest on the server and memory-only in the app screen.

The pharmacist opens **Scan QR with camera**. Camera frames are decoded locally using a lazily loaded ZXing QR reader; frames are neither uploaded nor saved by the application. A scan fills the reference and stops the camera. **Verify reference** still calls the existing authenticated pharmacy endpoint; scanning never verifies or dispenses automatically. Existing role, verified pharmacy membership, prescription eligibility, expiry, revocation and quantity checks remain authoritative. Closing, navigating away, hiding the browser tab or switching pharmacy/account releases the stream. Late camera-permission grants are also cleaned up. Camera permission/availability failures preserve manual entry. Camera access requires HTTPS or localhost; an HTTP LAN address is not sufficient.

## Nearby pharmacies after a facility stockout

For each active prescription with a known positive remaining quantity, the app checks the existing facility-pharmacy fulfilment response. Items marked unavailable, partially available or unknown trigger recommendations. A missing linked facility pharmacy is treated as unknown, never proof of a stockout. Available items and completed/cancelled/expired prescriptions do not trigger discovery.

With valid saved patient coordinates, the app automatically searches within 15 km, using the full medication name and remaining prescribed quantity. Without coordinates it explains why results are absent and offers **Use phone location**; operating-system permission is requested only after that action. Device coordinates are used for the search without overwriting the patient profile. Permission denial/location failure leaves the existing manual coordinate search usable. The patient can refresh results or expand to 50 km.

Only active verified pharmacies with a matching full medication name, confirmed positive stock, reported inventory within 24 hours, and a computed distance are recommended. The prescribing facility pharmacy is excluded from alternatives. Up to three pharmacies per item appear in nearest-first order, with on-hand quantity, full/partial coverage and a directions action. Distances are approximate straight-line distances; the map provides travel directions. Matching uses the full stored medication name; the inventory model has no separate formulation/strength fields, so pharmacists still verify the prescribed dosage and product before dispensing. No pharmacy is described as near without coordinates. Partial quantities are labelled explicitly. No medication substitution, stock reservation or guaranteed availability is implied; patients are asked to confirm before travelling. A no-results response is limited to the searched radius.

The Pharmacy search API adds optional `exact_match=true`; the default substring search is retained for manual discovery. Exact matching occurs before the result limit. Stale, future-dated and inconsistent facility-stock reports now produce unknown availability instead of falsely suppressing alternatives. No database migration is needed.

## Verification

- 14 Pharmacy tests passed on a newly created isolated PostgreSQL instance; it was stopped and removed after testing. Coverage includes exact-name filtering before limiting results, stale facility stock, membership/ownership, expiry/revocation, dispensing concurrency and audit integrity.
- 27 Flutter tests passed: QR rendering, recommendations, missing location, exact quantity queries, retry/account isolation and existing patient-care/offline regressions.
- A real local Flutter widget/API check confirmed that a synthetic facility stockout automatically displays its matching nearby pharmacy and excludes a different-strength item.
- Firefox browser acceptance passed using actual Flutter-rendered QR pixels in a synthetic canvas MediaStream and real authenticated backend verification. It checked explicit verification, manual fallback, denied permission, track cleanup after scan/close/tab hide, and late permission grants after close. It is not a claim of physical-camera or physical-phone testing.
- Staff-web and Pharmacy TypeScript checks, API type generation, two QR parser/error unit tests and focused native static analysis passed.

Local fixtures and screenshots are ignored under `.local/qr-evidence`; no tokens, references or credentials belong in source control. Deployment requires updated Pharmacy service, staff web dependencies and a rebuilt patient app. Existing mobile pharmacy membership and clinical workflows remain in effect.
