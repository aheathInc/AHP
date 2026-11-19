# Display and accessibility controls

The Human Care identity remains unchanged. Display preferences are available through **Display & accessibility** in the web toolbar, including before sign-in. The patient app exposes equivalent controls in its existing language and appearance settings. Preferences are local to the browser or device and contain no clinical records.

## Motion and surfaces

Web animation is limited to control feedback, directional action cues and the settings-panel focus transition. The app retains native platform route transitions and its bounded hero/press feedback. There are no looping card reveals or delayed access to clinical content.

The device's reduced-motion setting always takes priority. Users may independently request reduced motion. The web applies the saved setting before first paint and responds to live device preference changes. CSS animations and transitions stop immediately while loading text and status messages remain available. Native `MediaQuery` exposes the effective preference, route transitions return visible content directly, and the application's own press/hero animations respect it. Native back-navigation behaviour remains platform based when motion is allowed.

Glass is limited to navigation/modal backdrops on the web and the patient dashboard's bento frame. Clinical data and document surfaces stay opaque. Solid surfaces disable background blur/transparency; high contrast and supported device reduced-transparency settings also enforce solid web surfaces. CSS support detection provides an opaque fallback. Shadows use shared, downward soft-elevation tokens, and high contrast suppresses decorative elevation.

## Colour accessibility

Options are Human Care standard, red–green friendly, blue–yellow friendly and high contrast. These adjust interface status colours; they do not simulate vision or filter clinical images, documents or logo assets. Labels remain authoritative and shared web status badges also include icons. Colour is never the sole status channel.

Semantic badge foreground/background contrast is tested at 4.5:1 or better for the accessible web palettes in light and dark appearances. Native text, secondary text, warning and danger colours are tested against their surfaces. The standard native warning colour is darker to meet that same reading contrast. These checks support the implementation; they are not a claim of formal accessibility certification or coverage of every legacy feature-specific chart.

## Behaviour and persistence

Web appearance, density, motion, vision and solid-surface preferences use the existing `ahp.staff.*` storage namespace. If storage is blocked, controls still apply for the current page and the panel reports that persistence is unavailable. The native app uses its existing secure preference storage and only updates state after a successful write. Invalid stored values fall back to defaults.

The web panel uses native modal semantics, contains keyboard focus and restores focus on Escape/close. It scrolls at narrow phone heights and retains a reachable Done control. High contrast uses explicit borders and underlined links. Native settings retain the application's Swahili, English and French translations.

## Dashboard layout

The platform overview uses three actionable priority tiles above unequal service-coverage and governance panels. Each queue retains its real count, oldest waiting record, status wording and destination link. Tiles collapse into a single logical reading order on phones; no sample metrics or hidden totals were introduced.

## Verification

`apps/staff-web/tests/e2e/display-accessibility.spec.ts` covers persisted preferences, keyboard containment, live operating-system motion changes, blocked browser storage, palette contrast and narrow phone layout. `apps/patient-mobile/test/display_accessibility_test.dart` covers storage restore/fallback, palette contrast, settings changes, reduced native route transitions, solid surfaces and press feedback. Existing language and login-draft tests remain in the native verification set. Native rendering checks are performed through Flutter's rendering harness; physical-device acceptance remains separate.
