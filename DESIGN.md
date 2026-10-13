---
name: GetToken
description: Existing dark Chinese storefront with an independent /guides/ library of topic pages and articles.
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
  topic-section: "56px"
  topic-section-mobile: "40px"
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

The /guides/ library (hub, topic pages, articles) keeps the same canvas, ink and font stack in a standalone stylesheet, assets/guides/guides.css, so guide pages never load the homepage CSS or scripts. Each topic carries an accent tone. This record describes assets/gettoken/home.css, assets/guides/guides.css and the markup in scripts/build-site.mjs; page strategy stays in .impeccable/surfaces/seo-pages.md.

**Key Characteristics:**

- Dark tonal surfaces with fine separators.
- White pill actions and softly rounded storefront cards.
- Glass and ambient depth on the preserved storefront.
- Guide lists, topic cards and an open article column with native HTML links and disclosure.

The shipping raster assets/gettoken/logo.png is a pre-existing repository asset in the restored baseline. This extension introduces no raster artwork. External authorship or license details are not established by that provenance.

## Colors

The frontmatter preserves the reusable source values from home.css. guides.css repeats those neutrals as its own tokens and adds one accent per topic (`--tone` with a matching `--rgb`): blue (Codex), violet (Claude), orange (Claude Code), cyan (Gemini), silver (Grok) and green (buying basics). It does not load on the homepage.

### Primary

- **White action** (`button-light`): prominent pill actions with dark text.
- **Clear blue / pale blue** (`blue`, `blue-2`): storefront accent, navigation links, hover emphasis and keyboard focus.

### Secondary

- **Violet / pale violet** (`violet`, `violet-2`): existing Claude treatments and ambient action glow. The homepage's second headline line retains its original violet-to-pink gradient from `--grad`.
- **Green / pale green** (`green`, `green-2`): existing live status and residential-IP treatments.
- **Soft red** (`red`): existing warning and emphasis text.

### Neutral

- **Near-black canvas / tinted canvas / card** (`bg`, `bg-tint`, `card`): page background, alternate sections and storefront enclosures.
- **Quiet / stronger separator** (`line`, `line-2`): row boundaries, tables, contents and control strokes.
- **Primary / secondary ink** (`ink`, `ink-2`): titles and substantial reading text.
- **Muted / faint text** (`muted`, `faint`): auxiliary copy, labels and notes.

**The Shared Canvas Rule.** Guide pages inherit the homepage neutrals; prose links use a pale blue and topic accents mark only chips, marks, list hovers and topic headers.

## Typography

**Body Font:** the incumbent system stack recorded in the frontmatter supplies Chinese fallbacks without a remote font. The storefront uses its existing monospace stack for code, identifiers and technical values: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace.

### Hierarchy

- **Storefront body:** the body role in the frontmatter.
- **Guide body:** 15px with line-height 1.7 for lists and chrome; explanatory paragraphs use 1.8–1.9.
- **Article body:** 16px with line-height 1.95 in a column of at most 720px; 15.5px below 720px.
- **Introductions:** hub, topic and article leads use 17px with line-height 1.85 and a 62ch measure, reducing to 15px below 720px.
- **Labels and actions:** auxiliary labels commonly use 13px; standard actions use the button role. Compact header actions use 13px, weight 600.

Observed heading geometry: the original hero uses weight 800, line-height 1.15 and `clamp(36px, 4.6vw, 60px)`; its second line uses `clamp(28px, 3.9vw, 52px)`. Below 640px these become `clamp(24px, 7.2vw, 34px)` and `clamp(21px, 6.4vw, 30px)`. Guide hub and topic titles use `clamp(32px, 4.2vw, 52px)` with line-height 1.18; article titles use `clamp(28px, 3.4vw, 42px)` with line-height 1.3. Chinese titles are not balanced, so lines never break inside a word. Article section titles use 23px, becoming 21px on mobile. These are extracted geometry; the inherited system display face is recorded as legacy drift rather than a newly endorsed display choice.

**The Reading Rhythm Rule.** Keep substantial article text in the open reading column with its generous line-height; reserve muted text for auxiliary material.

## Layout

The shared shell is `min(1200px, 100% - 2 × gutter)`. home.css supplies the recorded desktop gutter and switches to the mobile gutter at 640px. The preserved homepage retains its 1100px, 960px, 640px and 370px adaptations, compact grids and purchase dialogs.

Guide pages use a 1180px shell (16px side gutters below 720px) under a sticky 64px glass header with the brand, a "指南" pill, every topic and a "查看套餐" action; below 720px the topics move to a sideways-scrolling row.

- **Hub:** tinted hero with breadcrumbs, eyebrow, H1, lead and stat pills beside a 400px glass "新手先读" list; a three-column grid of topic cards (mark, name, one-line scope, three guide links, "全部 N 篇"); the eight most recent guides as rows; FAQ and editorial sections with a 300px heading column; a closing call to action.
- **Topic:** a header glowing in the topic tone with a 64px mark, H1, intro and official source; three ruled facts; every guide of the topic as rows (own guides first, shared ones after), paginated at 20; other topics as pills; a call to action.
- **Article:** breadcrumbs, topic chip, H1, lead and a byline with the logo, update date and reading time; a 720px prose column beside a 260px sticky contents list and purchase card. At 1000px the aside disappears and the contents fold into a `details` block at the top of the article. Tables scroll inside a bordered wrapper. FAQ, sources and three related guides (as cards) follow.
- **Rows:** a 200px meta column (topic chip, date and reading time) beside the title and summary; one column below 720px.

Guide pages have no runtime JavaScript, forms or product selection.

## Elevation & Depth

The homepage retains glass fills, blur and faint top highlights alongside ambient shadows. Shared storefront cards deepen on hover-capable devices without tilt or position change. White pill actions gain violet ambient shadow on hover. Guide topic cards, related cards and calls to action use a dark card fill with a fine border that turns to the topic tone on hover; lists and article text stay open and separated by thin rules.

### Shadow Vocabulary

- **Glass highlight:** `var(--glass-highlight)` supplies the faint inset top edge on existing glass surfaces.
- **White-action hover:** `0 8px 28px -8px rgba(168, 85, 247, .6)` supplies the shared full-size light action glow.
- **Storefront-card hover:** `var(--glass-highlight), 0 22px 48px -24px rgba(0, 0, 0, .9), 0 12px 36px -18px rgba(var(--rgb), .35)` supplies ambient card depth.

**The Open Reading Rule.** Article text and list rows use spacing and separators; only topic cards, related guides and calls to action are enclosed.

## Shapes

Existing actions use pill silhouettes; storefront cards use the recorded card radius. Small controls and tags use softer small corners. Existing radio choices use the choice radius, with the period variation using the control radius. Article comparison wrappers use the container radius. Fine borders define reading rows and topics without enclosing their text.

## Components

### Buttons

The shared full-size light and ghost actions have a minimum 44px height; compact light and ghost header actions have a minimum 34px height. Their frontmatter values describe the source minimum heights, not fixed clipping. Light actions use white with dark text; ghost actions use a faint stroke with pale text. Ghost hover brightens the stroke and text; light hover adds violet ambient depth. The existing standard-action arrow shifts 3px on hover. The global focus treatment uses a 2px pale-blue outline with 3px offset and 6px radius. SEO header and article-aside spacing is contextual and does not replace the primitive padding.

### Storefront cards and product tags

Feature, product, tier and scene cards share the original layered dark fill, fine translucent border and glass top highlight. Feature and product cards use the recorded card padding; responsive feature layouts reduce it to 18px. Tags remain small bordered labels, with existing product accent color controlling their tint. They are not navigation filters.

### Storefront radio choices

The existing homepage pricing choices use native radio inputs over styled labels. Checked tier options gain a product-colored border and a soft tinted fill; checked period options use the solid product accent. Keyboard focus outlines the visible sibling label. These describe the preserved homepage controls; guide pages contain no form controls.

### Navigation and contents

The preserved storefront keeps its original desktop dropdown, mobile menu and glass header. The guide header is sticky with a translucent blurred fill; the current topic uses a faint filled pill. Article contents is a sticky list with a left rule whose hover marker takes the topic tone.

### Lists, disclosure and metadata

Guide rows, topic-card links and contents links brighten on hover; row titles take the topic tone. FAQs use native details/summary with a rotating plus marker. Prose, source and metadata links are underlined with a 4px offset. Every page shows the GetToken editorial byline with a semantic `time`; article dates come from Markdown front matter (`updated`, optional `published`) and topic or hub dates are the newest of their own copy and their guides, never the build time. Reduced-motion settings disable transitions on guide pages.

## Do's and Don'ts

### Do:

- **Do** inherit the existing dark canvas, pale text, logo and white action treatment.
- **Do** preserve the open article column, mobile contents reflow and generous Chinese-text line-height.
- **Do** keep native links, disclosure, keyboard focus and reduced-motion fallbacks.

### Don't:

- **Don't** replace the incumbent logo or treat this extension as approval for a new identity.
- **Don't** turn guide cards or article paragraphs into promotional cards: no prices, badges or purchase claims on reading entries.
- **Don't** introduce new product colors or page-specific accents without an established source.

Pre-existing drift not canonized or repaired: homepage eyebrow labels, text-glyph product marks and system display faces remain in the restored baseline. Their presence is not a rule for future surfaces; repairing them would exceed the user's explicit homepage-preservation scope.
