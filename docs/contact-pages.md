# Independent enterprise WeChat contact pages

New routes: `/support/hukaiyue/` (胡凯月) and `/support/huliyun/` (胡莉云). These pages follow GetToken's established dark styling and the public `/support/` page's introduction + QR structure. Only the QR regions are extracted from the two user-provided reference images; no avatars, full screenshots, generated code patterns or unverified service claims are used.

Source: `content/contact-pages.json`, `scripts/build-contact-pages.mjs`, `assets/contacts/contact.css` and the two QR PNGs. Regenerate with `node scripts/build-contact-pages.mjs`, or verify with `node scripts/build-contact-pages.mjs --check`. The generator only writes the two independent HTML files. It does not change existing navigation or existing support, delivery, home, converter or API files.

QR crops preserve the source image's decoded pixels without resampling. PNG metadata records source provenance, crop coordinates and original image hash. The originals and crops decode to identical WeCom URLs; both assets and their rendered page images decoded successfully at 320, 390, 768 and 1440 CSS pixels viewport width. Native downloads preserve the original PNG bytes. Scanning confirms payload equivalence, not that the contact is still accepting requests in WeChat.

## Review disposition

Both routes are ready to ship within the release boundary below. The desktop and mobile captures preserve the existing dark canvas, Chinese system typography and white pill actions; each page presents the correct name, a single QR, nearby save/original links and readable scan guidance. The mobile layout stacks cleanly, with navigation scrolling inside its own region. Scanner, download and overflow checks passed.

| Route | Disposition | Desktop capture | Mobile capture |
| --- | --- | --- | --- |
| `/support/hukaiyue/` | Ship | `.impeccable/review/contact-hukaiyue-1440.png` | `.impeccable/review/contact-hukaiyue-390.png` |
| `/support/huliyun/` | Ship | `.impeccable/review/contact-huliyun-1440.png` | `.impeccable/review/contact-huliyun-390.png` |

The contact-specific contract stays in `.impeccable/surfaces/contact-pages.md`. This narrow extension does not require updates to `PRODUCT.md`, `DESIGN.md` or shared tokens. Capture files are local review evidence, not deployment assets.

## Release boundary

The public site currently contains newer support/delivery pages that are absent from this repository revision. Do not publish the whole repository over the live site for this change. The pages and assets require a targeted release after the production source and deployment boundary are confirmed. No production workflow, server snapshot/export, credential setup, navigation or deployment settings are included in this change. No release was performed.

Copying this change into a later full release requires adding these two independent routes to that release's package or generator after production source reconciliation. Avoid treating the old general deployment workflow as a safe way to publish them by itself.
