# Human Care patient application — DocSpot redesign

## Reference inspection (before implementation)

Primary reference: https://dribbble.com/shots/26901317-Doctor-Appointment-Mobile-App-Design-DocSpot

Three accessible images from this exact shot were downloaded and visually inspected:

- Overview: `46116752/dc5c3036aa2a389041d3ddf716822a43.png`: home, doctor profile, appointment card, floating navigation.
- Search: `46116757/3a98b1e1b8d5048bf34fa9b156faa924.png`: segmented search, query field, filters, map and result card.
- Booking: `46116758/8d269d600bb5ec34fe06ef3afb17ac0b.png`: date/slot selection, review/payment and success sheet.

Evidence is retained locally in the ignored `.local/docspot-research` directory at repository root. Other attachments were not exposed by the accessible page. These are presentation stills: animation, keyboard, validation, loading/error/empty behavior, actual font family and exact dimensional tokens cannot be verified from them. The following numbers are A-Health implementation decisions, not extracted DocSpot specifications.

### Observed design language and translation

| Observed characteristic | A-Health implementation |
| --- | --- |
| Pale neutral canvas, mostly white cards, little visible shadow | Appearance-aware paper/surface roles, flat white cards, one subtle elevation tier |
| Compact greeting, prominent rounded search, six category tiles | Remove oversized home marketing panel; direct search, six existing care destinations |
| Dark floating navigation with light selected area | Medical Blue Material navigation container, light selected indicator, retain all five labelled destinations |
| Circular doctor image, prominent name, specialty and supporting facts | Shared clinician identity component, real image only if supplied; honest initials otherwise; no invented ratings or prices |
| Appointment identity separated from date/time by a rule | Shared appointment card with clinician, explicit server status and labelled local date/time |
| White rounded form groups, clear selected slots and full-width primary action | Consistent inputs, chips, buttons and sheets; preserve actual slot availability and booking rules |
| Teal for selection and supporting emphasis | Official teal as accent; darker accessible teal foreground; official Medical Blue for primary actions |
| Large profile identity with subordinate metadata | Profile and clinical summaries use the same type roles and grouped surfaces |
| Simple outline/navigation icons, small specialty imagery | Existing Material icon family; no borrowed portraits, organ illustrations or decorative icon packs |

## Brand authority

Reviewed original `/home/kali/Downloads/A_HEALTH_Brand_Guide.pdf`, all six pages via extracted text. User selected Human Care. Medical Blue #123B64, Teal Green #12A99A, White #FFFFFF, Black #000000; Open Sans assets are already bundled. Preserve supplied logo proportions, clear space, full-colour/light and white/dark variants. Horizontal logo minimum suggested width160; symbol32. No logo recolouring, gradients, shadows, extra medical marks or third-party replacement type.

## Existing application audit

Flutter/Dart, Material3, standard Navigator/MaterialPageRoute. StatefulWidget plus dedicated repositories and secure-storage Listenable preferences; no Riverpod/GraphQL rewrite. Dio REST, owner-scoped SQLite/offline outbox, secure sessions, WebRTC, maps/GPS, biometric lock and device medication reminders remain intact. API and route inventory was generated from every Dart source into `.local/docspot-research/code-inventory.json` before editing.

Screen families: authentication/registration/security; home/services/records; facilities/clinicians/consultation/calls; appointments/rescheduling; medicines/pharmacy; diagnostics; family/packages; emergency/maps; messages/threads/community; continuity/front desk/history; check-ins/screening/vaccinations/education; bills/insurance; profile/settings/consent/feedback. All destinations must remain reachable.

Weaknesses identified: oversized navy home panel; competing card implementations (outlined Panel, shadowed PremiumCard, gradient ProfileCard); inconsistent input/button geometry; default list rows beside custom cards; long undifferentiated appointment metadata; small status/metadata typography; hard-coded light foregrounds in older screens; broad unconstrained desktop lists; unrelated gradient hero treatments on operational screens. Some source lints predate this work.

## Design specification

Operate mode: help an unwell patient find a service, understand current care and complete the next task. Brand remains fixed; reference-driven composition replaces the previous large-hero home. No illustrative clinical content, fake clinician photos, ratings, fees, map positions or availability. No workflow may be removed for visual simplicity.

1. Establish shared tokens and Material theme, then unify existing Panel/PremiumCard/ProfileCard through a single surface implementation.
2. Add shared clinician identity/status, appointment metadata, search/action and adaptive page primitives.
3. Apply compact search/category composition and floating native navigation to home. Keep emergency immediately discoverable.
4. Redesign clinician discovery, appointment/rescheduling and clinical detail presentation without changing API/validation logic.
5. Propagate page constraints, surface grammar, semantic colour and control treatments through every relevant screen family; preserve full-screen maps and calls.
6. Render real Flutter widgets for major screen families at390×844, wide widths and dark/enlarged text; explicitly distinguish synthetic fixtures from live records. Inspect captures as a batch, fix material findings and reconfirm.
7. Run targeted and broader functional tests and analysis; record build/runtime results and device limitations.

### Token contract

- Spacing:4,8,12,16,20,24,32,40; page gutter20 compact/32 wide.
- Corners:12 compact controls,20 standard cards,24 grouped surfaces,28 search/navigation. Material dialogs/sheets28.
- Type:Open Sans; headline28/700/1.2, title22/700/1.5, title-medium18/700/1.3, title-small16/600/1.35, body16/400/1.5, secondary14/400/1.45, metadata13/600. Text scales with accessibility.
- Targets:48 minimum; primary action52; search56; labelled bottom navigation80.
- Icons:20 metadata,24 controls,28 categories; avatar52/72 identity.
- Depth:flat default, optional1dp elevated; no decorative glass/gradients on operational surfaces.
- Motion:140ms press,200ms selection; easeOutCubic. Honor OS and saved reduced-motion settings; retain native route/back transitions.
- Layout:compact<600, intermediate600–839, expanded>=840; maximum reading width960. Maps/calls retain full canvas.

## Verification and delivery

Implemented shared tokens, Material theme and PatientSurface wrappers, compact home/search/categories, five-destination floating navigation and wide sidebar. Clinician discovery, appointment metadata, rescheduling, identity, reports and common operational screens now share the visual grammar. Existing backend/auth contracts, routes, API enums and clinical states remain unchanged. `patient_labels.dart` maps consent/report option values to readable labels; history timestamps use local `d MMM y HH:mm`. No new packages or reference artwork are shipped.

- Functional suite: 245 passed, 2 opt-in skips; component interaction suite: 2 passed.
- Native Flutter capture suite: 43 captures covering 27 states, zero layout exceptions; eight states additionally captured wide and dark at 1.3 text scale. Phone captures are 390×844 and wide captures 1280×844. Home waits for loaded content before capture.
- Targeted consent/prevention verification: 17 passed after label corrections.
- Final Linux debug build including review corrections passed (exit 0). Live native app/backend verification: 25/25 healthy, zero runtime exceptions.
- Full source analysis: zero errors, zero warnings, 110 informational style lints remain. Focused analysis of patient_labels, tokens, theme and six shared widget files: no issues found.
- Independent review accepted the Linux design and recognizable reference relationship. Review findings on privacy labels, feedback categories and dense history timestamps were corrected; narrow re-review confirmed all three resolved and retained the SHIP verdict. The 17 targeted tests and three recaptures passed.

Evidence: [screenshot gallery](docspot/gallery.html), [raw screenshot manifest](docspot/screenshots/manifest.json), [modified files](docspot/modified-files.txt), [handover](docspot/README.md). All 43 captures use synthetic fixtures, never patient records. Initial history overflow/wrapping findings were corrected before the final capture pass.

Linux widget captures and native runtime checks do not verify Android/iOS hardware, screen readers, on-screen keyboards, native back gestures, GPS, camera, device performance or exact animation matching. These are reference-informed stills, not a claim of pixel-perfect reproduction. Test skips and informational lints remain explicit limits.
