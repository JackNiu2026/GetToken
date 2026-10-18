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
import { PRODUCT_PAGES } from '../content/products.mjs';
import { PRODUCTS } from '../assets/gettoken/catalog.mjs';

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

test('internal links, fragment targets and static assets exist on every page, homepage included', async () => {
  for (const route of ROUTES) {
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
  assert.deepEqual(TOPICS.map(t => t.slug), ['claude', 'claude-code', 'codex', 'gemini', 'grok', 'basics']);
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
    for (const file of ['robots.txt', 'sitemap.xml', '404.html', 'assets/guides/guides.css', FEED_ROUTE]) assert.ok(entries.includes(file), file);
    assert.ok(!entries.some(name => /^(scripts|content|tests|\.git)\//.test(name)));
    assert.ok(!entries.some(name => /^navigation\//.test(name)), 'The retired hub is served by a redirect, not a file');
    for (const file of ['assets/gettoken/product.css', 'assets/gettoken/product.mjs', 'assets/gettoken/shop.mjs', 'assets/gettoken/catalog.mjs']) assert.ok(entries.includes(file), file);
    assert.ok(!entries.some(name => /^(claude-code|contact|about|privacy|purchase-terms)\//.test(name)), 'Only the five product pages ship at the top level');
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

// Homepage modules that this change must not touch (origin/main at 67b63d4).
const untouchedHashes = {
  "assets/gettoken/motion.mjs": "335199c74c5ab59ae9ddbb1c0c9c735f091829662964265d0f1310d86cbb6ded",
  "assets/gettoken/scenes.mjs": "b018d2e84ab4e1476f553b6df4236da8e783a6296e4e33c2d13a2d18353cb5c9",
};

test('homepage keeps its brand sections, sends buyers to product pages and shows no prices', async () => {
  await generateSite();
  for (const [file, expected] of Object.entries(untouchedHashes)) {
    assert.equal(createHash('sha256').update(await readFile(join(ROOT, file))).digest('hex'), expected, file);
  }
  const html = await readFile(join(ROOT, 'index.html'), 'utf8');
  assert.ok(!html.includes('guides.css'));
  for (const id of ['top', 'main', 'why', 'products', 'how', 'scenes', 'news', 'faq']) assert.ok(html.includes(`id="${id}"`), id);
  for (const gone of ['id="pricing"', 'id="tiers"', 'data-preset', '<dialog class="sheet" id="pay-dialog"', 'data-product=', '¥XX', '$XX']) assert.ok(!html.includes(gone), `Homepage must not contain ${gone}`);
  for (const p of PRODUCT_PAGES) assert.ok(html.includes(`href="./${p.slug}/"`), `Homepage links to /${p.slug}/`);
  assert.ok(html.includes('href="./guides/"'));
  const latest = [...html.matchAll(/class="news-card news-card--[a-z]+" href="\.\/guides\/([a-z0-9-]+)\/"/g)].map(m => m[1]);
  assert.deepEqual(latest, ARTICLES.slice(0, 3).map(a => a.slug), 'Latest block lists the three newest articles');
  assert.match(html, /<script type="module" src="\.\/assets\/gettoken\/home\.mjs\?v=storefront-20261018"><\/script>/);
});

test('product pages share one plan picker with factual availability', async () => {
  assert.deepEqual(PRODUCT_PAGES.map(p => p.slug), Object.keys(PRODUCTS));
  const nginx = await readFile(join(ROOT, 'scripts/nginx-seo-locations.conf'), 'utf8');
  for (const p of PRODUCT_PAGES) {
    const catalog = PRODUCTS[p.slug];
    const html = await htmlFor(`${p.slug}/`);
    assert.ok(nginx.includes(`|${p.slug}`) || nginx.includes(`(?:guides|${p.slug}`), `Nginx aliases cover /${p.slug}/`);
    assert.ok(html.includes(`data-subscription="${p.slug}"`));
    const choices = [...html.matchAll(/name="[a-z]+-tier" value="([a-z0-9]+)" data-tier-choice( checked)?/g)];
    assert.deepEqual(choices.map(m => m[1]), Object.keys(catalog.tiers));
    assert.deepEqual(choices.map(m => Boolean(m[2])), [true, false, false]);
    for (const tier of Object.values(catalog.tiers)) {
      assert.ok(html.includes(tier.name) && html.includes(tier.desc));
      for (const feature of tier.features) assert.ok(html.includes(feature));
    }
    // Subscriptions are billed by the month: no period choice. 住宅 IP keeps its intended period.
    assert.equal(html.includes(`name="${p.slug}-period" value="3" data-period checked`), !catalog.deliveries, `${p.slug} period choice`);
    if (catalog.deliveries) assert.ok(html.includes('data-selection-period>按月'));
    assert.equal(html.includes(`name="${p.slug}-delivery" value="topup" data-delivery checked`), Boolean(catalog.deliveries), `${p.slug} delivery choice`);
    assert.equal([...html.matchAll(/data-inquiry>/g)].length, 1);
    assert.ok(html.includes('data-selection-total>待报价'));
    assert.ok(html.includes('暂未受理 · 查看说明'));
    assert.ok(html.includes('class="g-btn g-btn--ghost" type="button" data-inquiry>'), 'A closed plan does not look like a buy button');
    assert.ok(!html.includes('<span>订阅</span>'), 'The header already switches products');
    assert.ok(html.indexOf('id="plans"') < html.indexOf('id="steps"'));
    assert.ok(html.indexOf('id="steps"') < html.indexOf('id="faq"'));
    assert.ok(!html.includes('data-plan data-product='));
    assert.ok(html.includes('data-dock hidden'), 'Phones keep the selection in view');
    for (const id of ['pay-dialog', 'query-dialog', 'plans', 'faq']) assert.ok(html.includes(`id="${id}"`), `${p.slug} ${id}`);
    assert.ok(html.includes('<script type="module" src="../assets/gettoken/product.mjs?v=site-ui-20261018"></script>'));
    assert.ok(html.includes('data-open-query'), 'Consultation opens the contact dialog');
    for (const [q, a] of p.faqs) assert.ok(html.includes(q) && html.includes(a));
    if (p.source) assert.ok(html.includes(`href="${p.source[1]}"`), 'Official prices cite their source');
    const graph = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1])['@graph'];
    const page = graph.find(n => n['@type'] === 'WebPage');
    assert.equal(page.dateModified, PAGES.find(x => x.route === `${p.slug}/`).modified);
    assert.equal(page.mainEntity['@type'], 'Service');
  }
});

test('every page shares the homepage header and footer, styled by the same rules', async () => {
  const home = await readFile(join(ROOT, 'assets/gettoken/home.css'), 'utf8');
  const chrome = await readFile(join(ROOT, 'assets/gettoken/chrome.css'), 'utf8');
  const copied = chrome.slice(chrome.indexOf('/* COPY:START home.css */'), chrome.indexOf('/* COPY:END */')).split('\n').slice(1).filter(Boolean);
  assert.ok(copied.length > 30);
  for (const line of copied) assert.ok(home.includes(line), `chrome.css drifted from home.css: ${line.slice(0, 80)}`);
  const labels = html => [...html.match(/<nav class="desktop-nav"[\s\S]*?<\/nav>/)[0].matchAll(/<(?:a|summary)\b[^>]*>([\s\S]*?)<\/(?:a|summary)>/g)]
    .map(m => m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ''));
  const expected = labels(await htmlFor(''));
  assert.deepEqual(expected, ['首页', 'Claude订阅', 'Codex订阅', 'Gemini订阅', 'Grok订阅', 'KYC审核', '住宅IP', 'AI新闻']);
  for (const route of ROUTES) {
    const html = await readFile(join(ROOT, route, 'index.html'), 'utf8');
    assert.deepEqual(labels(html), expected, `Header differs on /${route}`);
    assert.equal((html.match(/<footer class="site-footer"/g) || []).length, 1, `Footer on /${route}`);
    assert.ok(html.includes('id="mobile-nav"'), `Phone menu on /${route}`);
    const mobile = html.match(/<nav class="mobile-nav"[\s\S]*?<\/nav>/)[0];
    assert.deepEqual([...mobile.matchAll(/<a\b[^>]*>([^<]+)<\/a>/g)].map(m => m[1]), expected);
  }
  const admin = await readFile(join(ROOT, 'verify/admin/index.html'), 'utf8');
  assert.ok(admin.includes('site-header--admin') && !admin.includes('desktop-nav') && !admin.includes('site-footer'), 'The admin page has no storefront navigation');
});
