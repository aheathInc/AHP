# A-Health experience foundations

The product serves people completing care tasks. The shared interface now prioritizes the task, the current state and the next action. A visual treatment alone is not evidence of international competitiveness or certification.

## Staff web

The shared `ClinicalHero` implementation is a compact workspace header: title, explanatory copy and actions. It retains the component's public props for existing callers and the `ahp-hero-copy` selector used by existing checks, while removing decorative artwork, category badges and arrival animations from authenticated workspaces. Existing patient context, clinical state and actions remain in their original components.

Platform administrator navigation is grouped into Operations, Care services, Governance & billing, Insights and Settings. Every previous destination remains available; only the main group and the current route's group open by default. Navigation search and role guards remain authoritative. Existing sidebar collapse, mobile drawer, keyboard search, focus restoration, theme and density preferences are preserved.

Clinician navigation separates patient resources from care collaboration while retaining every destination.

Shared navigation, controls and table text use a more readable fixed scale with a 16px rem baseline. The page header adapts structurally to narrow windows instead of reducing text to fit. Brand colors come from the existing theme variables; dark mode follows those variables.

## Patient app

Home, Services and Records use a shared task introduction instead of decorative banners. Services are grouped and searchable in the selected interface language. Filtering searches only the local destination labels and categories. Emergency access remains visible even when the query has no matches. No service destination was removed. The existing navigation bar / expanded-window rail continues to determine navigation structure.

Family services show the family context, dependants and assigned team without an empty duplicate members heading. Unavailable clinicians are distinguished from an existing assignment. Packages expose name, price, availability and core benefits first, with expandable full details. Confirmation presents included services and exclusions before the request is sent. Request history, ownership checks, durable request keys and the administrative allocation workflow remain in place. Loading and empty states use reusable components. Shared panels now paint their surface through Material Ink so nested list tiles, expansion controls and tap feedback remain visible. New authored copy has English, French and Swahili translations.

## Quality checks

- Staff: scoped navigation, keyboard focus, navigation search, compact header geometry, narrow-window overflow and dark mode.
- Patient: service filtering, clear/recovery behavior, preserved emergency access, selected destination callbacks and expanded layout at 130% text scale.
- End-to-end: actual local staff login, care-team assignment, patient package request through Flutter and administrator review through the web BFF. Synthetic package prices are restored after acceptance.
- Static checks: staff TypeScript and focused Flutter analysis.

The UI-only native captures use Flutter's renderer and the app theme with real fonts. They are provisional layout evidence, not Android hardware screenshots. No connected phone or configured emulator was available for this pass. Device gestures, system text scaling, screen-reader behavior, keyboard insets and runtime performance still need acceptance on Android hardware. Full accessibility conformance, representative usability testing, localization review and production performance measurement are separate acceptance requirements; this pass does not claim them.

Useful commands:

```sh
pnpm --filter a-health-web type-check
cd apps/patient-mobile
flutter test test/service_directory_test.dart test/premium_ui_test.dart
flutter analyze lib/widgets/common.dart lib/widgets/premium.dart lib/widgets/service_directory.dart lib/screens/home_screen.dart lib/screens/family_screen.dart lib/screens/family_packages_screen.dart
```

Local acceptance uses the existing ignored synthetic family fixture with `AHP_FAMILY_PACKAGE_FIXTURE`. The opt-in native layout capture uses `AHP_EXPERIENCE_CAPTURE=1`. Neither should be run against production accounts.

Verified locally on 12 November 2026: eight native component/layout checks, two browser journeys, the linked live Flutter enrollment workflow, navigation invariants across seven staff roles and focused static analysis. Screenshots were inspected in a bounded desktop/mobile round with a single confirmation round.

The Android debug APK build was attempted but did not produce an APK. The configured `/usr/lib/android-sdk` lacks the required NDK `28.2.13676358`, and Gradle reported `LicenceNotAcceptedException`. Accepting the applicable SDK/NDK terms and installing the toolchain are environment prerequisites; no license agreement was accepted by the assistant. The successful Flutter renderer tests must not be reported as an Android APK or device acceptance result.
