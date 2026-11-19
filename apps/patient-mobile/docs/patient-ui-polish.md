# Patient UI refinement

Implementation record, 17 November 2026. This pass improves selected patient surfaces within the established native Flutter application; it does not represent a redesign of every app screen.

## Visual authority and preservation

The confirmed Human Care identity is the visual authority: existing logo assets, medical blue (`#123B64`), teal (`#12A99A`) and OpenSans. The refinement preserves the existing semantic palette, dark appearance, clinical status meanings, reduced-motion behavior and color-vision settings. It adds no illustrative patient records, scores, visits or providers. Existing data, API integrations and clinical states remain the source of truth.

The checked-in `PRODUCT.md` and `DESIGN.md` predate this confirmed identity. They still describe an A-Health petrol/mint identity, platform typography and earlier home/navigation composition. This is documented drift, not an instruction to revert the implementation. Those files and `.impeccable/design.json` were left untouched by this documentation pass; reconcile them separately against the confirmed brand before using them as current visual authority.

## Implemented surfaces

- Home prioritizes real facility search, starting a consultation and compact emergency access before supporting content. Appointments, medicines, labs and family provide direct shortcuts; visits and continued care adapt to available width.
- Wide layouts use a branded 224 dp sidebar. Phone layouts use a logo/settings/profile header and retain the five existing Material navigation destinations.
- Services use searchable, grouped rows. Facility search supports name/location filtering, clearing the filter, an empty result state and retrying failed loads.
- Appointment and diagnostic lists use a readable maximum width of 960 dp. Clinical page descriptions clarify purpose without interpreting patient information.
- Shared typography, buttons, search controls and contrast provide continuity between these surfaces. Existing accessibility preferences remain available.

Primary implementation locations are `lib/widgets/care_home.dart`, `lib/screens/home_screen.dart`, `lib/widgets/service_directory.dart`, `lib/screens/facility_browser_screen.dart`, `lib/core/theme.dart`, `lib/widgets/common.dart`, `lib/widgets/premium.dart`, the appointment, diagnostic and medication follow-up screens, and `assets/l10n/ui.json`.

## Reference research

The four supplied Google share links resolved to [Magnific modern app UI](https://www.magnific.com/free-photos-vectors/modern-app-ui), [Figma Community mobile apps](https://www.figma.com/community/mobile-apps), [Mobbin modern app screens](https://mobbin.com/explore/mobile/screens/modern-app) and [Dribbble modern app UI](https://dribbble.com/tags/modern-app-ui).

Figma access was blocked. Magnific exposed a category page but no useful individual design evidence. Public Mobbin content and Dribbble healthcare shot images, including Zest, MediCover and MindBridge, informed hierarchy, spacing and service discoverability. These references were directional inspiration rather than evidence of clinical usability. No reference artwork was copied into the shipped UI. Local research images are ignored under `../../.local/ui-research`.

## Verification and evidence

The implementation review reported 16 UI/accessibility tests and 13 clinical tests passing. Four focused tests passed after the emergency-order correction. Analysis of the core changed sources was clean; the broader appointment file retains eight pre-existing informational brace-style lints. Independent review accepted the Linux UI refinement after emergency ordering and shared-control styling corrections.

Native Linux captures are available under `.impeccable/review/`:

- `desktop-linux.png`: wide home layout.
- `phone-linux.png`: latest phone layout, with 390 dp content. The 462 px Linux window capture includes 72 px of window shadow.
- `tablet-dark-linux.png`: tablet-width dark appearance.
- `services-linux.png`: earlier services appearance; it predates the final shared-control correction and is not evidence of that final control style.

These are actual Flutter Linux windows, not Android or iOS device captures. Android/iOS hardware validation and device release checks remain pending. No HTML detector was applied because the application is native Flutter. Passing automated checks and Linux review do not establish device-specific rendering, keyboard, safe-area or assistive-technology behavior on mobile hardware.
