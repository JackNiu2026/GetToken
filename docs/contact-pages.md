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

The public site contains newer support/delivery pages that are absent from this repository revision. Do not publish the whole repository over the live site for this change. On 2026-11-24 the user explicitly confirmed “上线” after reviewing the two pages and the proposed contact-only release scope.

The isolated `.github/workflows/contact-pages.yml` workflow publishes only the two HTML files, contact.css, two extracted QR PNGs and an independent contact release checksum record. It uses the established production environment, concurrency group, SSH identity and strict host-key verification. It does not read server templates into logs or modify existing navigation, home/support/delivery pages, API service, Nginx configuration or the site's general deployment revision.

The archive installer rejects unexpected paths, symlinks and checksum mismatches before writing. Each approved file is installed atomically, failures roll back the approved files, and hashes of existing public pages are checked in memory before and after. Public acceptance compares the two HTTPS responses and QR bytes with the release manifest. No existing server file contents are exported.

Main commits whose title begins `[contact-pages]` use the isolated publisher; the old general workflow still runs tests but skips its full-site deployment for these explicitly marked releases. Use that title for contact-only merge commits to preserve newer live content. The publisher can also be run manually on main. Other full-site releases retain their existing behavior and require source reconciliation before use.

Package command: `python3 scripts/package-contact-pages.py contact-pages.tar.gz COMMIT_SHA`. Installer tests: `python3 -m unittest discover -s tests -p 'test_contact_release.py'`. The production publisher and public verifier are `scripts/deploy-contact-pages.sh` and `scripts/check-contact-pages.py`.
