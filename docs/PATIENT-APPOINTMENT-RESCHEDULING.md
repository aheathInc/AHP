# Patient appointment rescheduling

Patients can open Appointments → a future booked appointment → **Reschedule**, choose an available published time, and review the current and replacement times before confirming. The action is available from the appointment list and detail screen. Authorized guardians can use the same API for a dependant's appointment. The existing appointment identity, patient, clinician, consultation method, duration, reason and care-thread association are preserved.

The picker lists matching alternatives within the next 90 days and supports cursor pagination. Availability excludes occupied/withdrawn slots and times overlapping an existing booked/started appointment for either the patient or clinician. Displayed times use the device's local time and show its timezone. Availability is checked again on confirmation; selecting a time does not reserve it.

## Persistence and concurrency

`POST /appointments/{appointment_id}/reschedule` accepts exactly `slot_id` and the current positive `base_version`, plus the existing `Idempotency-Key` header. Only an active patient account that owns the appointment or is its recorded guardian may move it. This ownership check runs before an idempotency-cache replay and again inside the transaction, so a revoked guardian cannot retrieve a cached protected response.

Only future `booked` appointments can move. Started, completed, cancelled, no-show and past appointments cannot be rescheduled. Provider changes, duration changes and consultation-method changes require a separate booking workflow.

A transaction locks the appointment, serializes patient/calendar changes, secures the replacement slot and checks overlaps, updates the original appointment with an incremented version, releases the old reservation and appends the required audit/change records. Slot locks use a stable order. A failure rolls back the appointment and both slot flags. UTC comparisons explicitly avoid dependence on PostgreSQL's session timezone.

Start and cancel now take the same appointment row lock and read the current row inside their transaction. Version-aware cancellation rejects a stale `base_version`; the field remains optional for older clients. A cancellation without a version remains a legal serialized cancellation of the current booking. Initial booking also claims its slot and appends required audit/change records in one transaction.

The mobile flow sends rescheduling online only and does not enqueue it offline. A timeout is treated as unconfirmed: the client reads the persisted appointment and reports success only when the selected slot/time and a newer version are confirmed. Otherwise it asks the patient to refresh. Owner changes clear the picker and close any open confirmation; late responses cannot announce success for another signed-in account.

## Calendar and history

Migration: `20261112130000_patient_rescheduling`.

- Adds `slots.is_published`, initially true for existing slots.
- Replaces the lifetime uniqueness of `appointments.slot_id` with a partial unique index for non-cancelled appointments.
- Retains cancelled appointment history while allowing a published free slot to be booked again.
- Changes the Prisma Slot relation to a collection of historical appointments.

Calendar republishing withdraws availability instead of deleting slot rows referenced by history. Existing reservations remain booked even if omitted from a new calendar. Once cancelled or moved, an omitted slot remains withdrawn; explicitly republishing it makes it bookable again. Appointment and Doctor services share the calendar lock, preventing publication from racing a slot claim.

Apply the forward migration before starting the updated Appointment and Doctor services and deploy those services together. Migration execution was first rehearsed on disposable PostgreSQL. During the requested local startup, the development database on 127.0.0.1:55432 was backed up and both pending AFPE/rescheduling migrations were applied successfully. No production database was changed. Rolling back to code that assumes one lifetime appointment per slot requires compatibility review once slot reuse has occurred. Do not delete appointment history to restore the old constraint.

## API

| Method and route | Behavior |
|---|---|
| GET `/appointments/{appointment_id}/reschedule-options` | Current authorized appointment, clinician name, matching slots and cursor metadata |
| POST `/appointments/{appointment_id}/reschedule` | Atomic move with appointment version and idempotency protection |
| POST `/appointments/{appointment_id}/cancel` | Existing cancellation; optional `base_version` now prevents stale cancellation |

Protected appointment responses, including cached replays, use `Cache-Control: no-store`. The options cursor is opaque and validated; callers cannot choose a different patient or clinician through query parameters. The OpenAPI source and generated API types include the new operations.

## Verification

- Fresh migration rehearsal on a dedicated loopback PostgreSQL 17 `ahealth_test` instance on a dynamically chosen non-5432 port.
- 32 real-database Appointment tests passed, including concurrency, overlap detection, guardian authorization/revocation, actual JWT HTTP routes, idempotent replay, publication/history compatibility, and forced audit-failure rollback.
- 13 Doctor service regression tests passed.
- Audit hash-chain verification passed across all 157 synthetic events.
- 10 focused Flutter repository/widget tests passed; 23 related patient-care regression tests also passed.
- API contract generation and staff-web TypeScript checks passed; native analysis found no issues in the new screen, repository and focused tests.
- The final rerun passed all 10 rescheduling tests plus 9 core patient-care tests after the accessibility changes.
- Live local communication check: real patient OTP login, rescheduling through the Flutter screen, then staff browser sign-in and BFF read of the same booking at version 2. Both browser reads returned 200 without proxy failures. This widget/network check does not claim a physical-device launch.

The isolated database contains synthetic fixtures only and is stopped after verification. Test suites use the repository's local-target and connected-identity guards. No production migration, provider delivery or physical-device acceptance is implied by these checks.
