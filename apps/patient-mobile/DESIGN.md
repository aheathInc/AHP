---
name: Human Care Patient
description: Reference-driven native healthcare with calm surfaces and clear next actions.
colors:
  medical-blue: "#123B64"
  teal-green: "#12A99A"
  ink: "#172B3F"
  ink-soft: "#526577"
  paper: "#F3F5F6"
  surface: "#FFFFFF"
  paper-sunk: "#EDF2F6"
  line: "#E1E6EA"
  deep-ocean: "#102E4C"
  mint-wash: "#E3F5F1"
  amber: "#805000"
  clay: "#A63D2F"
  dark-ink: "#ECF2FA"
  dark-ink-soft: "#B6C6D8"
  dark-paper: "#0B1724"
  dark-surface: "#12263A"
  dark-paper-sunk: "#193249"
  dark-line: "#344E65"
  dark-primary: "#A5C9EF"
  dark-mint-wash: "#153E43"
  dark-amber: "#FFD08A"
  dark-clay: "#FFA397"
typography:
  headline:
    fontFamily: OpenSans
    fontSize: "28px"
    fontWeight: 700
    lineHeight: 1.2
  title:
    fontFamily: OpenSans
    fontSize: "22px"
    fontWeight: 700
    lineHeight: 1.5
  title-medium:
    fontFamily: OpenSans
    fontSize: "18px"
    fontWeight: 700
    lineHeight: 1.3
  title-small:
    fontFamily: OpenSans
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.35
  body:
    fontFamily: OpenSans
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
  body-large:
    fontFamily: OpenSans
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.5
  body-small:
    fontFamily: OpenSans
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: OpenSans
    fontSize: "16px"
    fontWeight: 500
    lineHeight: 1.5
rounded:
  control: "12px"
  card: "20px"
  group: "24px"
  pill: "28px"
spacing:
  xxs: "4px"
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "20px"
  xl: "24px"
  xxl: "32px"
  section: "40px"
components:
  button-primary:
    backgroundColor: "{colors.medical-blue}"
    textColor: "{colors.surface}"
    rounded: "{rounded.pill}"
    height: "52px"
  field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "16px 14px"
  surface:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.card}"
    padding: "20px"
  navigation:
    backgroundColor: "{colors.deep-ocean}"
    textColor: "{colors.surface}"
    height: "80px"
  chip:
    backgroundColor: "{colors.mint-wash}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "10px 12px"
---

# Design System: Human Care Patient

## Overview

**Creative North Star: "Human Care"**

Human Care brings the compact search, category grid, grouped appointment details and dark floating navigation of the inspected DocSpot stills into the official A-Health identity. Medical Blue, restrained teal, Open Sans and quiet surfaces support patients finding care and understanding their next action.

This implemented system supersedes the previous petrol palette, system-font and large-hero direction. The reference guides composition; existing clinical meaning, available data, navigation and native behavior remain authoritative.

**Key Characteristics:**
- Compact search and six care destinations on home.
- Rounded flat surfaces with explicit clinical labels.
- Adaptive reading width and accessible semantic colors.

## Colors

### Primary
Medical Blue anchors primary actions and identity. Deep Ocean anchors dark navigation. The legacy source names `petrol` and `petrolLift` now resolve to the blue family; they do not authorize the former green palette.

### Secondary
Teal Green provides restrained supporting emphasis. Selected areas use Mint Wash. Use the theme's darker teal foreground for readable light-theme text.

### Neutral
Paper separates the canvas from white surfaces; Ink and Ink Soft establish hierarchy. Dark tokens are semantic counterparts, not simple inversions. `AppPalette.accessible` additionally adapts high contrast and color-vision modes.

**The Clinical Meaning Rule.** Amber means attention and clay means a problem or urgency; status must also have a text label.

## Typography

OpenSans is bundled locally and used throughout. The frontmatter records the shared theme roles; metadata uses 13px/600 in shared status components and home categories use 13px with wrapping. Do not make fixed-height containers depend on one-line translated copy. Keep Kiswahili, English and French labels readable at enlarged text scales.

## Layout

Dimensions are Flutter logical pixels. The spacing scale is shared through `CareSpace`. Compact layouts are below 600; expanded navigation begins at 840. Ordinary pages use `PatientScaffold` with maximum reading width 960. Maps and calls preserve their full canvas. Home uses 20px compact gutters and 32px wide gutters, rounded search, six category tiles, and a floating Material navigation bar with five labels. Expanded home uses a 224px sidebar. Minimum targets are 48px; primary actions 52px, search 56px and navigation 80px. Respect insets, scrolling and keyboard resizing.

## Elevation & Depth

Flat tonal grouping is the default. `PatientSurface` has no shadow and uses an outline when explicitly requested or in high contrast. Material app bars may gain 1dp scrolled-under elevation. Do not create a competing shadow vocabulary.

## Shapes

Use the shared control, card, group and pill radii from frontmatter. Dialogs and sheets use pill radius. Retain supplied logo proportions and one-head clear space; horizontal logos have suggested minimum width 160 and symbols 32. Use official light/dark logo variants.

## Components

`PatientSurface` is the common material for Panel, PremiumCard and ProfileCard. Tappable surfaces use InkWell and a 0.985 press scale over 140ms. Selection changes use 200ms easeOutCubic. OS and saved reduced-motion preferences disable authored motion; native route and back behavior is retained.

Use shared clinician identity with truthful initials fallback, labelled status chips, grouped appointment date/time and explicit reschedule fields. Keep local history dates human-readable. Forms use shared filled fields and pill actions; clinical reports group results by report. Loading, empty and error states remain actionable and preserve clinical meaning. This is not a reconstruction of unobserved DocSpot animations.

The sidecar's HTML/CSS snippets are isolated preview translations of native Flutter components, not shipped app assets. Source authority: `lib/core/design_tokens.dart`, `lib/core/theme.dart`, `lib/widgets/patient_ui.dart`, and the shared home, common, premium, profile and login widgets.

## Do's and Don'ts

- Do use semantic palette roles in light, dark and accessibility modes.
- Do retain all five labelled navigation destinations and existing workflows.
- Do use real clinician images only when available; otherwise use initials.
- Do respect text scaling, reduced motion and native navigation.
- Do not invent ratings, availability, prices, clinician photos or clinical states.
- Do not use amber or clay for decoration.
- Do not add decorative gradients or glass to operational surfaces.
- Do not distort, recolor or add effects to the supplied logo.
