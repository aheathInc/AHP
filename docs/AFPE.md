# AFPE implementation and operating boundaries

Requirements source: `AFPE_Software_Requirements_Specification.docx`.

AFPE implements the supplied Automated AI Longitudinal Follow-Up & Prognosis Engine specification in the existing Consultation and Follow-up services. This is source implementation with a research scoring policy; clinical validation and live provider acceptance are release requirements.

## Workflows

A clinician can enable AFPE while signing a consultation, or configure an existing assigned active cycle from the Doctor follow-up desk. The form requires signed ICD-10 codes, a clinical category or approved automatic mapping, discharge symptom severity, actual discharge vital readings, acceptable vital ranges, medication applicability and consent attestation. The note, cycle and initial AFPE plan are committed together when enabled at consultation completion. Existing-cycle activation is separately transactional and requires the source consultation to be completed and signed by the configuring clinician.

The baseline is immutable. A changed clinical baseline requires a new clinically reviewed cycle. AFPE does not change prescriptions or invent medication times. Explicit clinician-approved medication schedules continue to drive dose reports and reminders.

Patient App → Ufuatiliaji wangu → Follow-up → My health progress shows the latest report, research score ring, confirmed-dose streak and history. Check-ins collect symptom severity, side effects, requested vital measurements and danger signs. Readings can be left unavailable: missing information produces an incomplete score. Emergency guidance remains visible even when submission fails or is queued offline.

Doctor → Follow-up defaults to an exception filter, with an option to see all assigned cycles. The longitudinal panel contains score and adherence trends, an accessible values table, a three-bullet clinical digest, exact response links and timestamped dose evidence. The digest is deterministic and source-linked. The optional model selects approved conversational questions; it does not author unrestricted medical advice or free-form SOAP prose.

## Diagnosis and cadence

The same ICD-10 code can describe different clinical stages. Automatic mapping therefore requires both a signed code and clinician-confirmed context. Configure `AFPE_DIAGNOSIS_RULES_JSON` identically in Consultation and Follow-up. Each rule needs `id`, `code_prefix`, `context`, `category`, `approved_by`, and an ISO `approved_at`. Contexts: `new`, `stable`, `uncontrolled`, `high_risk`, `postoperative`, `treatment_initiation`. Categories: `acute`, `subacute`, `chronic`.

No medical mappings are invented or enabled by default. The deployment's clinical lead must supply approved mappings. Unmatched automatic requests fail with an explanation; explicit clinician category selection remains available. Multiple matches select the highest-risk category. Applied rule IDs are retained with the plan and assessment evidence.

| Category | Routine cadence | Initial window |
|---|---|---|
| Acute | Daily | 14 days |
| Subacute | Every 7 days | 90 days |
| Chronic | Every 30 days | Ongoing while active; the administrative window is renewed |

A caution result shortens the next interval to half the routine interval, rounded down with a minimum of one day. A subsequent non-caution result restores the routine cadence. Cycle closure remains an explicit clinical action. Schedulers serialize with response/closure operations using cycle row locks. New check-ins are bounded; overdue events do not create a backlog of historic conversations.

## Scoring policy `afpe-srs-v1`

The specification defines weights but not component normalization. The implementation makes the following research assumptions explicit:

- Adherence: percentage of eligible explicitly scheduled doses reported `taken` since the previous assessment. `missed` and `delayed` are not on-time reports. Any unreported dose, or an empty expected medication window when medication applies, leaves adherence unknown. A clinician-confirmed absence of prescribed medication assigns 100 for this component.
- Symptoms: `max(0, 100 - 10 × max(0, current_severity - discharge_severity))`. Both severities use the explicit 0–10 scale.
- Biometrics: percentage of clinician-configured vital measures within their configured ranges. Every configured measure must be available. No reference ranges or missing readings are assumed.
- Composite: rounded `0.4 × adherence + 0.4 × symptoms + 0.2 × biometrics`. Any missing component leaves the numeric score null.
- Ordinary bands: 80–100 green, 60–79 yellow, below 60 red. A vital outside a clinician-configured range requires at least caution, even if the weighted score reaches green.

A red flag overrides the band to red and caps any complete numeric score at 59. Red flags remain urgent when a numeric score is unavailable. Other escalation conditions are a score below 60, chronic score below 70, two subacute weekly declines strictly greater than 10 points, and two missed chronic check-ins. Adaptive short-interval responses do not count as separate weekly observations. Missed chronic check-ins are checked independently of the next monthly due date.

These assumptions are not a validated clinical prediction model. The score measures the configured reported inputs; it does not establish diagnosis, recovery, treatment effectiveness or absence of danger. Clinical governance must approve or replace this version before clinical deployment. Production activation, scoring and scheduling refuse to run until `AFPE_CLINICAL_POLICY_APPROVED=true`; that setting records the operator’s attestation and does not itself establish clinical validation.

## Conversation and safety

Hard-coded English/Swahili phrases, structured chest pain/severe bleeding/difficulty breathing, and measured temperature above 39°C bypass model inference and raise an urgent clinician alert. Phrase screening is conservative: negated or historical mentions may still trigger review. It is not semantic diagnosis.

The default assistant uses approved bilingual structured questions. An optional HTTPS inference adapter receives the authorized baseline, current clinical note, prescribed medications, bounded recent interaction history and current patient text. The adapter may return only one `question_key`: `symptoms`, `adherence`, `side_effects`, or `vitals`. The service validates that enum and renders reviewed wording locally. It never executes model-provided instructions, changes medication or exposes unrestricted model prose. Assistant requests are bounded to 2,000 characters and 20 ordinary interactions per check-in; urgent screening continues after the ordinary question limit.

Set `AFPE_AI_URL` and `AFPE_AI_KEY` only for an authorized inference processor. Expected response: `{"question_key":"symptoms"}`. The endpoint is a generic adapter contract, not a claim that any model vendor is already connected. Patient reports and medication instructions remain deterministic and clinician authored respectively.

## API and external contracts

All `/care-continuity` endpoints require existing JWT authentication. Mutating app routes use the existing idempotency middleware. Patient access is restricted to self/authorized dependants. Configuration and alert acknowledgement require the verified active assigned clinician. Private clinical digests/evidence are omitted from the patient report.

| Endpoint | Purpose |
|---|---|
| POST `/care-continuity/cycles/{id}/afpe` | Activate a reviewed baseline and schedule |
| GET `/care-continuity/cycles/{id}/afpe` | Authorized longitudinal report |
| POST `/care-continuity/cycles/{id}/afpe/preferences` | Explicit patient SMS/WhatsApp opt-in or opt-out |
| POST `/care-continuity/check-ins/{id}/conversation` | Protected conversational check-in prompt |
| GET `/care-continuity/afpe/alerts` | Assigned clinician's open alerts |
| GET `/care-continuity/afpe/events` | Dashboard server-sent events, refreshed every 5 seconds |
| POST `/care-continuity/afpe/alerts/{id}/acknowledge` | Scoped alert acknowledgement |
| GET `/check-ins/{check_in_id}` | Protected exact source response |
| POST `/integrations/gothomis/discharge` | Signed mapped hospital-discharge callback |
| POST `/integrations/afpe/messages` | Signed consented patient message/structured answer |

The dashboard uses an authenticated BFF stream and reconnects after 55 seconds. Every stream update rechecks clinician verification and account status. This is a dashboard alert stream, not FCM/APNs background push or a staffed emergency response guarantee.

GoTHOMIS payload: `{"cycle_id":"existing-platform-cycle-uuid","configuration":{...AFPE activation fields...}}`. The hospital adapter must map the discharge to an existing AHP cycle and signed consultation. The callback cannot create arbitrary patient identities or overwrite a baseline. Exact replays return the existing plan. Integration-origin activation is audited as integration-origin, not as a personally executed clinician action. This generic callback is not certification of compatibility with a particular GoTHOMIS installation. No DHIS2 export adapter is included.

Both external callbacks use `X-AFPE-Timestamp` (Unix seconds within 300 seconds) and `X-AFPE-Signature` (hex HMAC SHA-256 of `timestamp + "." + exact_raw_JSON_body`). Configure separate `GOTHOMIS_WEBHOOK_SECRET` and `AFPE_MESSAGING_WEBHOOK_SECRET` values through private runtime configuration. Publish only the required callback paths through the deployment's authenticated integration edge.

For inbound messaging, send `message_id`, `check_in_id`, `channel` (`sms` or `whatsapp`), `sender` (registered E.164 number), `text`, and `language` (`en`/`sw`). The channel must be explicitly consented by the patient or authorized guardian and the sender must exactly match that consented account. An optional `answers` object follows the existing check-in response contract and is evaluated transactionally. WhatsApp source transport is retained in AFPE assessment evidence; it is not mislabeled as an app-origin clinical response. Repeated submitted answers cannot overwrite a final response. Conversation message identifiers deduplicate completed replies; a provider should treat already-answered response conflicts as final.

Set `AFPE_MESSAGING_URL` and `AFPE_MESSAGING_KEY` for a generic HTTPS outbound adapter. It receives `channel`, `to`, `template`, `reference` (check-in UUID) and generic text. It must honor the stable `Idempotency-Key` header. Provider-specific SMS/WhatsApp APIs require an adapter implementing this contract. Opt-in is unavailable until the adapter is configured. A leased outbox retries with backoff and a five-attempt bound, rechecks consent, account/guardian eligibility, active-cycle and unanswered status before sending, and suppresses stale messages. Existing generic SMS check-in reminders are suppressed when the explicit AFPE fallback handles that check-in, while in-app reminders remain available.

Provider HTTP acceptance is recorded as accepted, not handset delivery. A crash after remote acceptance can cause a retry; exactly-once delivery requires provider idempotency. Consent withdrawal cannot recall an already accepted message. Live telecom, WhatsApp and model-vendor acceptance have not been performed.

## Migration and verification

Forward migration: `packages/database/prisma/migrations/20261112120000_afpe`. New tables: `afpe_plans`, `afpe_assessments`, `afpe_alerts`, `afpe_interactions`, `afpe_deliveries`. Existing clinical tables are related through foreign keys; existing history is preserved. Schema checks constrain scores, bands, categories and delivery states. A partial unique index protects AFPE schedule slots.

Generate the Prisma client and apply the migration through the normal reviewed deployment procedure before starting the updated services. Do not roll back by dropping clinical evidence tables. No existing/shared database was migrated during implementation.

Pure tests: `node --import tsx services/followup/src/tests/afpe-engine.test.ts`. Database tests: `services/followup/src/tests/afpe.integration.ts`; run separately with `pnpm --filter @a-health/followup test:afpe:db` against a fresh disposable target. These enforce the repository's isolated-local-target and identity guards and require a migrated disposable target. They cover ownership, source diagnosis matching, immutable setup, concurrent scheduling/replies, source-linked reports, alerts, adaptive cadence, missed chronic check-ins and leased consented delivery.

A disposable PostgreSQL rehearsal was attempted, but this execution sandbox rejected loopback TCP socket creation (`Operation not permitted`) before the server started. The database integration suite and migration application are therefore not executed acceptance evidence. Guards were not relaxed. Type checks, API generation, Prisma schema validation and isolated pure policy/signature tests are reported separately.

Deployment must supply encrypted storage/backups, TLS termination, authorized inference processing, integration credentials and operational alert ownership. This implementation does not establish Tanzanian regulatory compliance, validate the prognosis model, or demonstrate clinician response times. Those are deployment and clinical-governance acceptance tasks.

## Implementation check results

| Check | Result |
|---|---|
| AFPE pure policy, input, diagnosis mapping and signature tests | 17 passed, 0 failed |
| Follow-up TypeScript build check | Passed |
| Consultation TypeScript build check | Passed |
| Staff Web TypeScript check | Passed |
| API contract generation | Passed; existing repository contract warnings remain |
| Prisma schema validation and client generation | Passed |
| Changed native-screen Dart analysis | No errors or warnings; existing style information remains |
| Mechanical UI detector | No findings; not visual/browser acceptance |
| Guarded real-database AFPE integration suite | Authored, not executed: sandbox rejected PostgreSQL TCP socket creation |
| Migration application, live providers and authenticated browser/device acceptance | Not performed |

The database rehearsal directory was removed after the server failed to start. No existing service or database was changed. The source remains uncommitted for review.
