# Staff consultation queue improvements

Doctor → Consultation queue now supports:

- Server-side urgency filtering across the assigned/offered queue, with deterministic cursor ordering.
- Cursor pagination beyond the first 50 records. Additional pages deduplicate consultation IDs.
- Search within loaded authorized request IDs, symptom text, facilities and modalities. Patient names are not added to pre-acceptance summaries.
- Ordering loaded records by server-assigned urgency and SLA deadline, or by request age.
- Loaded-record SLA-overdue counts, last successful refresh time and an explicit refresh action.
- A shared clock for offer-expiry and SLA labels.

Automatic refresh runs every 15 seconds while the tab is visible and the first page is being viewed. Viewing additional pages pauses automatic refresh; the interface explains that manual refresh returns to the first page. Local search and sorting cover loaded records, not the entire hospital queue. Urgency filtering runs before database pagination, so matching offers cannot be lost through post-page filtering.

Request generations, read cancellation and a context-bound result snapshot prevent responses from an earlier scope or urgency filter from appearing as the current queue. The queue remounts when the authenticated user changes. Refresh failures retain the last loaded records with a stale-data warning; accept/decline controls remain disabled until a successful refresh. Accept and decline use a synchronous global action guard and disable other mutation controls while the action is pending. Server-side assignment, expiry and transition rules remain authoritative. Accept success opens the selected case directly.

Validation: three pure workflow tests cover actionable offer expiry/state, urgency/deadline ordering, authorized-field search and deterministic ordering. Backend and frontend TypeScript checks are run separately. Authenticated browser and real-database acceptance are not established by these tests; the current sandbox blocks PostgreSQL TCP socket creation.
