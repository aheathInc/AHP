# A-Health Human Care interface

The owner selected **Human Care** from `A_HEALTH_Brand_Guide.pdf` on 17 November 2026. Original artwork and font files come from the supplied `A_HEALTH_02_Human_Care.zip`. The guide is the authority for the logo, palette, typography and proportions. Existing clinical workflows and permission boundaries remain authoritative for product behaviour.

| Foundation | Use |
|---|---|
| Medical Blue `#123B64` | Primary actions, navigation and brand surfaces |
| Teal Green `#12A99A` | Connection and selected-state accents; not small white text backgrounds |
| White `#FFFFFF` | Light surfaces and supplied white logo variant on dark backgrounds |
| Open Sans 400 / 600 / 700 | Body text, hierarchy and controls |

The web hosts WOFF2 fonts locally; the patient app bundles the supplied TTF fonts. The original font licence and copyright accompany both distributions. Logo paths and typography remain outlined and unmodified. The wordmark is not recreated as interface text. Colour artwork is used on light backgrounds and the original white artwork on dark surfaces. Compact navigation uses the original symbol rather than shrinking the horizontal logo below its readable size. Taglines are separate interface copy where space permits, using the supplied wording: “Connecting Healthcare. Empowering Lives.”

Shared web styling is in `apps/staff-web/app/brand-system.css`, loaded after legacy feature styles so existing workflows can adopt the foundations consistently. Legacy token names remain compatible. Clinical success, warning and emergency states keep their distinct semantic colours. Dark surfaces and accessible lighter foreground tones are derived interface colours, not replacements for the brand colours in artwork.

Patient app theme foundations live in `apps/patient-mobile/lib/core/theme.dart`; `BrandLogo` chooses original raster artwork by appearance and arrangement. Sign-in remains scrollable at small widths and larger text scales. The shared theme retains generous reading sizes and padded touch targets.

Public `/brand`, `/fonts` and `/design` asset directories are served before sign-in. The middleware exemption is bounded to those directory roots; it does not exempt clinical pages or lookalike route prefixes. Session and role guards remain in place.

Validation includes production web compilation, desktop and phone-width browser checks for admin, research and clinician workspaces, password visibility, mobile navigation, appearance and density controls. Native widget checks cover 320, 390 and 800 logical-pixel widths, light/dark appearance and increased text size; they do not substitute for physical-device acceptance testing.
