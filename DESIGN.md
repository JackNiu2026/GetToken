---
name: GetToken
description: Existing dark Chinese storefront with independent subscription navigation and articles.
colors:
  bg: "#0b0b10"
  bg-tint: "#0e0e14"
  card: "#111118"
  line: "#1f2030"
  line-2: "#2c2d40"
  ink: "#f4f5f8"
  ink-2: "#cdd0dc"
  muted: "#8f93a6"
  faint: "#7a7e93"
  blue: "#3b82f6"
  blue-2: "#7aa7ff"
  violet: "#a855f7"
  violet-2: "#c4a3ff"
  green: "#10b981"
  green-2: "#4ee0b0"
  red: "#fb7185"
  button-light: "#fff"
typography:
  body:
    fontFamily: 'system-ui, -apple-system, "SF Pro Text", "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif'
    fontSize: "14px"
    lineHeight: 1.6
  navigation-body:
    fontSize: "15px"
    lineHeight: 1.6
  reading-body:
    fontSize: "16px"
    lineHeight: 1.95
  label:
    fontSize: "13px"
  button:
    fontSize: "14px"
    fontWeight: 600
rounded:
  tag: "6px"
  control: "8px"
  choice: "9px"
  container: "12px"
  card: "16px"
  pill: "999px"
spacing:
  control-gap: "8px"
  card-gap: "14px"
  gutter-mobile: "18px"
  gutter: "24px"
  card-padding: "22px"
  storefront-section: "88px"
  storefront-section-mobile: "64px"
  topic-section: "48px"
  topic-section-mobile: "34px"
components:
  button-light:
    backgroundColor: "{colors.button-light}"
    textColor: "{colors.bg}"
    typography: "{typography.button}"
    rounded: "{rounded.pill}"
    padding: "0 24px"
    height: "44px"
  button-ghost:
    backgroundColor: "rgba(255, 255, 255, .02)"
    textColor: "{colors.ink-2}"
    typography: "{typography.button}"
    rounded: "{rounded.pill}"
    padding: "0 24px"
    height: "44px"
  pill-button:
    backgroundColor: "{colors.button-light}"
    textColor: "{colors.bg}"
    rounded: "{rounded.pill}"
    padding: "0 16px"
    height: "34px"
  ghost-button:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    rounded: "{rounded.pill}"
    padding: "0 14px"
    height: "34px"
  storefront-card:
    rounded: "{rounded.card}"
    padding: "{spacing.card-padding}"
  storefront-choice:
    backgroundColor: "rgba(255, 255, 255, .015)"
    textColor: "{colors.muted}"
    rounded: "{rounded.choice}"
    padding: "6px 4px"
  product-tag:
    backgroundColor: "rgba(59, 130, 246, .06)"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.tag}"
    padding: "3px 9px"
---

# Design System: GetToken

## Overview

**Creative North Star: "Existing GetToken dark storefront"**

The Chinese interface, GetToken wordmark and existing raster logo remain the visual authority. The preserved homepage uses a compact dark storefront with glass surfaces, blue/violet emphasis, pale text and white pill actions. This name describes the incumbent design rather than a newly selected identity.

The independent subscription navigation and its thirteen articles inherit the same canvas and font stack. Their information uses open sections, fine separators and a wider reading rhythm. This record describes assets/gettoken/home.css, assets/gettoken/pages.css and the markup in scripts/build-site.mjs; page strategy stays in .impeccable/surfaces/seo-pages.md.

**Key Characteristics:**

- Dark tonal surfaces with fine separators.
- White pill actions and softly rounded storefront cards.
- Glass and ambient depth on the preserved storefront.
- Open navigation and article layouts with native HTML links and disclosure.

The shipping raster assets/gettoken/logo.png is a pre-existing repository asset in the restored baseline. This extension introduces no raster artwork. External authorship or license details are not established by that provenance.

## Colors

The frontmatter preserves the reusable source values from home.css. pages.css defines no new color primitives and does not load on the homepage.

### Primary

- **White action** (`button-light`): prominent pill actions with dark text.
- **Clear blue / pale blue** (`blue`, `blue-2`): storefront accent, navigation links, hover emphasis and keyboard focus.

### Secondary

- **Violet / pale violet** (`violet`, `violet-2`): existing Claude treatments and ambient action glow. The homepage's second headline line retains its original violet-to-pink gradient from `--grad`; pages.css does not override it.
- **Green / pale green** (`green`, `green-2`): existing live status and residential-IP treatments.
- **Soft red** (`red`): existing warning and emphasis text.

### Neutral

- **Near-black canvas / tinted canvas / card** (`bg`, `bg-tint`, `card`): page background, alternate sections and storefront enclosures.
- **Quiet / stronger separator** (`line`, `line-2`): row boundaries, tables, contents and control strokes.
- **Primary / secondary ink** (`ink`, `ink-2`): titles and substantial reading text.
- **Muted / faint text** (`muted`, `faint`): auxiliary copy, labels and notes.

**The Shared Canvas Rule.** Navigation and articles inherit the homepage palette; their links use the existing pale blue.

## Typography

**Body Font:** the incumbent system stack recorded in the frontmatter supplies Chinese fallbacks without a remote font. The storefront uses its existing monospace stack for code, identifiers and technical values: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace.

### Hierarchy

- **Storefront body:** the body role in the frontmatter.
- **Navigation body:** the navigation-body role; longer explanatory paragraphs use line-height 1.85–1.9.
- **Article body:** the reading-body role, capped at 74ch; its mobile size is 15px with the same line-height.
- **Introductions:** navigation and article leads use 17px with line-height 1.9, reducing to 15px below 700px. Navigation introduction width is 66ch; article lead width is 70ch.
- **Labels and actions:** auxiliary labels commonly use 13px; standard actions use the button role. Compact header actions use 13px, weight 600.

Observed heading geometry: the original hero uses weight 800, line-height 1.15 and `clamp(36px, 4.6vw, 60px)`; its second line uses `clamp(28px, 3.9vw, 52px)`. Below 640px these become `clamp(24px, 7.2vw, 34px)` and `clamp(21px, 6.4vw, 30px)`. Navigation titles use `clamp(30px, 3.5vw, 46px)` with line-height 1.35; article titles use `clamp(30px, 3.5vw, 44px)` with line-height 1.4 and become 29px below 700px. Article titles use `text-wrap: balance` to distribute wrapped lines more evenly on narrow screens. Article section titles use 24px, becoming 22px on mobile. These are extracted geometry; the inherited system display face is recorded as legacy drift rather than a newly endorsed display choice.

**The Reading Rhythm Rule.** Keep substantial article text in the open reading column with its generous line-height; reserve muted text for auxiliary material.

## Layout

The shared shell is `min(1200px, 100% - 2 × gutter)`. home.css supplies the recorded desktop gutter and switches to the mobile gutter at 640px. The preserved homepage retains its 1100px, 960px, 640px and 370px adaptations, compact grids and purchase dialogs.

The independent /navigation/ page uses a wrapping row of topic anchors, two explanatory columns with a 64px gap, open topic sections and two columns of reading links with a 48px gap. Topic facts pair a 160px label column with a flexible description, separated by 32px. At 700px these structures become single columns and the header links move to a full-width row.

The thirteen articles use an open reading column and a 240px sticky contents column with a 72px gap. At 960px the aside narrows to 200px with a 36px gap. At 700px it moves into normal flow before the article; its links form two columns. Comparison tables scroll inside a bordered wrapper on narrow screens. Each article includes two native FAQ disclosures and three related article links. Related reading reuses the two-column reading-link layout below a fine separator, with 36px/52px vertical padding that becomes 28px/38px on mobile. New pages have no runtime JavaScript, inquiry form or product selection workflow.

## Elevation & Depth

The homepage retains glass fills, blur and faint top highlights alongside ambient shadows. Shared storefront cards deepen on hover-capable devices without tilt or position change. White pill actions gain violet ambient shadow on hover. The SEO header, navigation sections, reading links and article contents remain open and separated by thin rules.

### Shadow Vocabulary

- **Glass highlight:** `var(--glass-highlight)` supplies the faint inset top edge on existing glass surfaces.
- **White-action hover:** `0 8px 28px -8px rgba(168, 85, 247, .6)` supplies the shared full-size light action glow.
- **Storefront-card hover:** `var(--glass-highlight), 0 22px 48px -24px rgba(0, 0, 0, .9), 0 12px 36px -18px rgba(var(--rgb), .35)` supplies ambient card depth.

**The Open Reading Rule.** Navigation rows and article sections use spacing and separators; they do not inherit the storefront card enclosure.

## Shapes

Existing actions use pill silhouettes; storefront cards use the recorded card radius. Small controls and tags use softer small corners. Existing radio choices use the choice radius, with the period variation using the control radius. Article comparison wrappers use the container radius. Fine borders define reading rows and topics without enclosing their text.

## Components

### Buttons

The shared full-size light and ghost actions have a minimum 44px height; compact light and ghost header actions have a minimum 34px height. Their frontmatter values describe the source minimum heights, not fixed clipping. Light actions use white with dark text; ghost actions use a faint stroke with pale text. Ghost hover brightens the stroke and text; light hover adds violet ambient depth. The existing standard-action arrow shifts 3px on hover. The global focus treatment uses a 2px pale-blue outline with 3px offset and 6px radius. SEO header and article-aside spacing is contextual and does not replace the primitive padding.

### Storefront cards and product tags

Feature, product, tier and scene cards share the original layered dark fill, fine translucent border and glass top highlight. Feature and product cards use the recorded card padding; responsive feature layouts reduce it to 18px. Tags remain small bordered labels, with existing product accent color controlling their tint. They are not navigation filters.

### Storefront radio choices

The existing homepage pricing choices use native radio inputs over styled labels. Checked tier options gain a product-colored border and a soft tinted fill; checked period options use the solid product accent. Keyboard focus outlines the visible sibling label. These describe the preserved homepage controls; new navigation and articles contain no form controls.

### Navigation and contents

The preserved storefront keeps its original desktop dropdown, mobile menu and glass header. The independent SEO header is a simple bordered row with the existing brand, two links and a return-home ghost action. Pale blue marks its current navigation link and hover state. Topic anchors use open underlined boundaries; article contents uses a sticky bordered list until mobile reflow.

### Reading links and disclosure

Reading entries use a fine top separator, 22px vertical padding, a 17px title at weight 550 and a muted 14px description. Hover turns the title pale blue. The navigation and article FAQs use native details/summary with 20px summary padding and open body paragraphs. Article FAQ summaries use primary ink; their text size is 15px. Source and prose links are visibly underlined. These elements inherit the global keyboard-focus treatment. Reduced-motion styles disable transitions and animations in SEO pages; the original homepage retains its existing reduced-motion behavior.

### Editorial metadata

Article headers and the navigation editorial-policy section show GetToken content attribution and a semantic update date. This auxiliary line uses 13px type, muted text, line-height 1.8 and 20px top spacing. Its attribution link uses secondary ink with an underline offset of 4px. The currently shipped date is 2026-10-09, held in content metadata rather than generated on every build; dates describe substantive content updates. Related-reading headings use the existing 24px article-section size, reducing to 22px on mobile. These remain open reading elements in the established Read surface.

## Do's and Don'ts

### Do:

- **Do** inherit the existing dark canvas, pale text, logo and white action treatment.
- **Do** preserve the open article column, mobile contents reflow and generous Chinese-text line-height.
- **Do** keep native links, disclosure, keyboard focus and reduced-motion fallbacks.

### Don't:

- **Don't** replace the incumbent logo or treat this extension as approval for a new identity.
- **Don't** turn the navigation reading links or article paragraphs into promotional cards.
- **Don't** introduce new product colors or page-specific accents without an established source.

Pre-existing drift not canonized or repaired: homepage eyebrow labels, text-glyph product marks and system display faces remain in the restored baseline. Their presence is not a rule for future surfaces; repairing them would exceed the user's explicit homepage-preservation scope.
