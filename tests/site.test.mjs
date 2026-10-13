import test from 'node:test';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { readFile, stat, mkdtemp, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { ROOT, ROUTES, PAGES, ARTICLES, PAGE_SIZE, FEED_ROUTE, chunk, generateSite } from '../scripts/build-site.mjs';
import { SITE } from '../content/site.mjs';
import { TOPICS } from '../content/topics.mjs';

const base = SITE.origin.replace(/\/$/, '');
const htmlFor = route => readFile(resolve(ROOT, route, 'index.html'), 'utf8');

test('generated static pages match the content sources', async () => {
  await generateSite({ check: true });
});

test('every indexable route has unique metadata, readable content and matching sitemap URL', async () => {
  const sitemap = await readFile(join(ROOT, 'sitemap.xml'), 'utf8');
  const locations = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
  assert.deepEqual(locations, ROUTES.map(route => `${base}/${route}`));
  assert.equal(new Set(locations).size, ROUTES.length);
  const titles = new Set();
  const descriptions = new Set();
  for (const route of ROUTES) {
    const html = await htmlFor(route);
    const title = html.match(/<title>([^<]+)<\/title>/)?.[1];
    assert.ok(title, route);
    assert.ok(!titles.has(title), `Duplicate title: ${title}`);
    titles.add(title);
    assert.equal([...html.matchAll(/<h1\b/g)].length, 1, route);
    assert.ok(html.includes(`href="${base}/${route}"`), `Canonical: ${route}`);
    assert.match(html, /<meta name="description" content="[^"]+">/);
    assert.doesNotMatch(html, /<meta name="robots" content="noindex/);
    assert.match(html, /<html lang="zh-CN"/);
    if (route) {
      const description = html.match(/<meta name="description" content="([^"]+)">/)[1];
      assert.ok(!descriptions.has(description), `Duplicate description on ${route}`);
      descriptions.add(description);
      assert.match(html, /<nav class="g-crumbs" aria-label="面包屑">/, `Visible breadcrumbs: ${route}`);
    }
    for (const match of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
      const data = JSON.parse(match[1]);
      assert.equal(data['@context'], 'https://schema.org');
      assert.ok(data['@graph'].length > 0);
      assert.ok(!data['@graph'].some(item => item['@type'] === 'Offer'), 'No invented pricing offers');
      if (route) assert.ok(data['@graph'].some(item => item['@type'] === 'BreadcrumbList'), route);
    }
  }
});

test('internal links, fragment targets and static assets exist for every guide page', async () => {
  for (const route of ROUTES.filter(Boolean)) {
    const html = await htmlFor(route);
    const baseUrl = new URL(route, 'https://local.test/');
    for (const [, raw] of html.matchAll(/(?:href|src|action)="([^"]+)"/g)) {
      const value = raw.replace(/&amp;/g, '&');
      const address = new URL(value, baseUrl);
      if (address.origin !== 'https://local.test') continue;
      let target = resolve(ROOT, `.${decodeURIComponent(address.pathname)}`);
      const info = await stat(target).catch(() => null);
      assert.ok(info, `Broken target on ${route}: ${raw}`);
      if (info.isDirectory()) target = join(target, 'index.html');
      assert.ok((await stat(target)).isFile());
      if (address.hash) {
        const text = await readFile(target, 'utf8');
        const id = decodeURIComponent(address.hash.slice(1));
        assert.ok(text.includes(`id="${id}"`), `Missing fragment on ${route}: ${raw}`);
      }
    }
  }
});

test('topics, articles and pagination stay connected as the library grows', async () => {
  assert.deepEqual(TOPICS.map(t => t.slug), ['codex', 'claude', 'claude-code', 'gemini', 'grok', 'basics']);
  for (const topic of TOPICS) {
    const listed = ARTICLES.filter(a => a.topics.includes(topic.slug));
    assert.ok(listed.length > 0, `Topic without guides: ${topic.slug}`);
    const pages = PAGES.filter(p => p.kind === 'topic' && p.topic === topic.slug);
    assert.equal(pages.length, Math.ceil(listed.length / PAGE_SIZE));
    const html = (await Promise.all(pages.map(p => htmlFor(p.route)))).join('');
    for (const a of listed) assert.ok(html.includes(`guides/${a.slug}/`), `${a.slug} is missing from the ${topic.slug} topic`);
    assert.ok(topic.facts.length >= 3);
  }
  for (const a of ARTICLES) assert.ok(a.sections.length >= 2, a.slug);
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunk([], 20), [[]], 'An empty topic still renders one page');
  const hub = await htmlFor('guides/');
  for (const t of TOPICS) assert.ok(hub.includes(`href="../guides/${t.slug}/"`), `Hub links to ${t.slug}`);
});

test('RSS feed lists the newest guides with canonical links', async () => {
  const xml = await readFile(join(ROOT, FEED_ROUTE), 'utf8');
  assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>\n<rss version="2.0"/);
  assert.ok(xml.includes(`<atom:link href="${base}/${FEED_ROUTE}" rel="self"`));
  const links = [...xml.matchAll(/<item><title>[^<]+<\/title><link>([^<]+)<\/link>/g)].map(m => m[1]);
  assert.deepEqual(links, ARTICLES.slice(0, 50).map(a => `${base}/guides/${a.slug}/`));
});

test('deployment archive contains all routes and excludes project sources', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'gettoken-package-test-'));
  try {
    const archive = join(temp, 'site.tar.gz');
    execFileSync(process.execPath, ['scripts/package-site.mjs', archive], { cwd: ROOT });
    const entries = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n');
    for (const route of ROUTES) assert.ok(entries.includes(`${route}index.html`), route);
    for (const file of ['robots.txt', 'sitemap.xml', 'assets/guides/guides.css', FEED_ROUTE]) assert.ok(entries.includes(file), file);
    assert.ok(!entries.some(name => /^(scripts|content|tests|\.git)\//.test(name)));
    assert.ok(!entries.some(name => /^navigation\//.test(name)), 'The retired hub is served by a redirect, not a file');
    assert.ok(!entries.some(name => /^(codex|gemini|grok|claude|claude-code|contact|about|privacy|purchase-terms)\//.test(name)), 'Withdrawn storefront extensions must not ship');
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

// Latest GitHub homepage baseline (origin/main at 0fe017b).
const originalHashes = {
  "index.html": "35591101e6ed3e352b857dee7efe73f9129d4a40aff4d65f90cba525a7644f10",
  "assets/gettoken/home.css": "9c987236832cf40c65d24c3f717e702a2414704f2adb1db1235f5bb454daadef",
  "assets/gettoken/home.mjs": "e83c08a2cb96cfbf134bdd99f4f40257e4f9529b095428fc2421e5d237b3f694",
  "assets/gettoken/motion.mjs": "335199c74c5ab59ae9ddbb1c0c9c735f091829662964265d0f1310d86cbb6ded",
  "assets/gettoken/scenes.mjs": "b018d2e84ab4e1476f553b6df4236da8e783a6296e4e33c2d13a2d18353cb5c9",
  "assets/gettoken/catalog.mjs": "4e35927f4d9f69dd45ebb28c595d393222f4422a458b3ea3ad8180b385633c21",
  "assets/gettoken/site.config.mjs": "d1101008992c4b3073dd37b5a77454d08c0ac55b142b114ab3e70d3f31ea9b20"
};

test('SEO generation preserves the original homepage and all existing UI modules exactly', async () => {
  await generateSite();
  for (const [file, expected] of Object.entries(originalHashes)) {
    assert.equal(createHash('sha256').update(await readFile(join(ROOT, file))).digest('hex'), expected, file);
  }
  assert.ok(!(await readFile(join(ROOT, 'index.html'), 'utf8')).includes('guides.css'));
});
