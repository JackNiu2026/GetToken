#!/usr/bin/env node
// Generates the product pages (/codex/, /claude/ …), the /guides/ library (hub, topic pages,
// articles), robots.txt, sitemap.xml and the RSS feed. On the homepage it only refreshes the
// block between the LATEST markers in index.html; everything else there is hand-written.
import { readFileSync, statSync } from 'node:fs';
import { readFile, writeFile, mkdir, readdir, rm, rmdir } from 'node:fs/promises';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITE } from '../content/site.mjs';
import { TOPICS } from '../content/topics.mjs';
import { HUB } from '../content/hub.mjs';
import { PRODUCT_PAGES } from '../content/products.mjs';
import { PRODUCT_FACTS } from '../content/product-facts.mjs';
import { PRODUCTS, PERIOD_NAMES, getQuote, formatMoney, totalLabel } from '../assets/gettoken/catalog.mjs';
import { inquiryState } from '../assets/gettoken/inquiry.mjs';
import { VERIFY } from '../assets/gettoken/verify-rules.mjs';
import { ROOT, loadArticles, validateLibrary, inline, esc, dateIsValid } from './content.mjs';

export { ROOT };
const origin = new URL(SITE.origin);
if (origin.protocol !== 'https:' || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') {
  throw new Error('SITE.origin must be an HTTPS origin without credentials, query or path.');
}
const ORIGIN = origin.origin;
export const ARTICLES = loadArticles();
validateLibrary(ARTICLES);
for (const t of TOPICS) if (!dateIsValid(t.updated)) throw new Error(`Topic ${t.slug} needs an updated date`);
for (const p of PRODUCT_PAGES) {
  if (!Object.hasOwn(PRODUCTS, p.slug)) throw new Error(`Product page ${p.slug} has no catalog entry`);
  if (!dateIsValid(p.updated)) throw new Error(`Product page ${p.slug} needs an updated date`);
  if (p.topics.some(slug => !TOPICS.some(t => t.slug === slug))) throw new Error(`Product page ${p.slug} lists an unknown topic`);
  if (Object.keys(PRODUCTS[p.slug].tiers).length !== 3) throw new Error(`Product ${p.slug} must have three tiers`);
}

export const PAGE_SIZE = 20;
export const FEED_ROUTE = 'guides/feed.xml';
// Generated output lives only in these directories; anything else in them is removed as stale.
const MANAGED_DIRS = ['guides', 'navigation', 'verify', ...PRODUCT_PAGES.map(p => p.slug)];

const latest = dates => dates.filter(Boolean).sort().at(-1);
const topicOf = slug => TOPICS.find(t => t.slug === slug);
// A topic lists its own articles first, then shared guides that also cover it; each group newest first.
const topicArticles = t => [...ARTICLES.filter(a => a.topic === t.slug), ...ARTICLES.filter(a => a.topic !== t.slug && a.topics.includes(t.slug))];
export const chunk = (items, size) => Array.from({ length: Math.max(1, Math.ceil(items.length / size)) }, (_, i) => items.slice(i * size, (i + 1) * size));
const topicRoute = (t, page = 1) => `guides/${t.slug}/${page > 1 ? `page/${page}/` : ''}`;
const articleRoute = a => `guides/${a.slug}/`;
const productRoute = p => `${p.slug}/`;
export const VERIFY_ROUTE = 'verify/';
export const VERIFY_ADMIN_ROUTE = 'verify/admin/';
const VERIFY_UPDATED = '2026-10-17';
// The product page that sells what a topic covers; shared topics (选购基础) have none.
const productFor = topicSlug => PRODUCT_PAGES.find(p => p.topics.includes(topicSlug));
// The product's own articles first, then shared guides that also cover it; each group newest first.
const productArticles = p => [...ARTICLES.filter(a => p.topics.includes(a.topic)), ...ARTICLES.filter(a => !p.topics.includes(a.topic) && a.topics.some(slug => p.topics.includes(slug)))];
const productModified = p => latest([p.updated, ...productArticles(p).map(a => a.updated)]);

const HUB_MODIFIED = latest([HUB.updated, ...ARTICLES.map(a => a.updated)]);
const topicModified = t => latest([t.updated, ...topicArticles(t).map(a => a.updated)]);

// Every canonical page with the facts the live audit and reports need.
export const PAGES = [
  { route: '', kind: 'home' },
  ...PRODUCT_PAGES.map(p => ({ route: productRoute(p), kind: 'product', modified: productModified(p), product: p.slug })),
  { route: VERIFY_ROUTE, kind: 'verify', modified: VERIFY_UPDATED },
  { route: 'guides/', kind: 'hub', modified: HUB_MODIFIED },
  ...TOPICS.flatMap(t => chunk(topicArticles(t), PAGE_SIZE).map((_, i) => ({ route: topicRoute(t, i + 1), kind: 'topic', modified: topicModified(t), topic: t.slug, page: i + 1 }))),
  ...ARTICLES.map(a => ({ route: articleRoute(a), kind: 'article', modified: a.updated, article: a })),
];
export const ROUTES = PAGES.map(p => p.route);
// Old addresses that the web server permanently redirects.
export const REDIRECTS = [['navigation/', 'guides/']];

const json = value => JSON.stringify(value).replace(/</g, '\\u003c');
const url = route => `${ORIGIN}/${route}`;
const href = (route, to = '') => `${'../'.repeat(route.split('/').filter(Boolean).length)}${to}`;
const organization = { '@type': 'Organization', '@id': `${ORIGIN}/#organization`, name: 'GetToken', url: url(''), logo: url('assets/gettoken/logo.png') };
const website = { '@type': 'WebSite', '@id': `${ORIGIN}/#website`, name: 'GetToken', url: url(''), inLanguage: 'zh-CN', publisher: { '@id': organization['@id'] } };
function shareImage(route) {
  const image = SITE.shareImages[route] || SITE.shareImage;
  if (!/^assets\/[A-Za-z0-9_./-]+\.(png|jpe?g|webp)$/.test(image.path) || image.path.split('/').includes('..')
    || !image.alt || !Number.isInteger(image.width) || image.width < 1 || !Number.isInteger(image.height) || image.height < 1
    || !statSync(resolve(ROOT, image.path)).isFile()) throw new Error(`Invalid share image for ${route}`);
  return image;
}
function shareImageMeta(route) {
  const image = shareImage(route);
  return `<meta property="og:image" content="${url(image.path)}">
<meta property="og:image:alt" content="${esc(image.alt)}">
<meta property="og:image:width" content="${image.width}">
<meta property="og:image:height" content="${image.height}">
<meta name="twitter:card" content="summary">
<meta name="twitter:image" content="${url(image.path)}">
<meta name="twitter:image:alt" content="${esc(image.alt)}">`;
}
const crumbList = items => ({ '@type': 'BreadcrumbList', itemListElement: items.map(([name, route], i) => ({ '@type': 'ListItem', position: i + 1, name, item: url(route) })) });
function crumbNav(route, items) {
  return `<nav class="g-crumbs" aria-label="面包屑"><ol>${items.map(([name, to], i) => i === items.length - 1
    ? `<li><span aria-current="page">${esc(name)}</span></li>`
    : `<li><a href="${href(route, to)}">${esc(name)}</a></li>`).join('')}</ol></nav>`;
}
const time = date => `<time datetime="${date}">${date}</time>`;

// Where a reader goes to buy: the product page for the topic, otherwise the homepage product list.
function buyLink(route, topicSlug) {
  const p = topicSlug && productFor(topicSlug);
  return p ? { href: href(route, productRoute(p)), label: `${PRODUCTS[p.slug].name} 价格与方案`, name: PRODUCTS[p.slug].name } : { href: `${href(route)}#products`, label: '选择产品', name: null };
}

/* ---------- Site header and footer ---------- */
// One header and one footer for every page, the homepage included (between its HEADER and FOOTER
// markers). Styles: home.css on the homepage, chrome.css elsewhere (kept identical by tests).
// `current`: 'home' | 'product' | 'verify' | 'guides'. `contact`: 'dialog' opens the page's
// customer-service dialog; 'link' goes to the homepage, which opens it (/#contact).
const CHEVRON = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5 6 7.5l3-3"/></svg>';
const GLYPH_CLASS = { codex: 'codex', claude: 'claude', gemini: 'gemini', grok: 'grok', ip: 'ip' };
const SOON = '<em class="nav-soon">查看状态</em>';
const linkTo = (route, to = '') => (route === null ? `./${to}` : href(route, to));
const anchor = (route, id) => (route === null ? `#${id}` : `${linkTo(route)}#${id}`);

export function siteHeader({ route = null, current = 'home', product = null, cta, contact = 'dialog' }) {
  const isHome = route === null;
  const contactButton = cls => (contact === 'dialog'
    ? `<button${cls ? ` class="${cls}"` : ''} type="button" data-open-query>联系客服</button>`
    : `<a${cls ? ` class="${cls}"` : ''} href="${anchor(route, 'contact')}">联系客服</a>`);
  const products = PRODUCT_PAGES.map(p => `<a href="${linkTo(route, productRoute(p))}"${p === product ? ' aria-current="page"' : ''}><span class="glyph glyph--${GLYPH_CLASS[p.slug]}">${esc(PRODUCTS[p.slug].glyph)}</span><span><strong>${esc(PRODUCTS[p.slug].name)}</strong><small>${esc(p.navHint)}</small></span></a>`);
  const mark = name => (current === name ? ' class="is-current" aria-current="page"' : '');
  return `<header class="site-header">
    <div class="shell header-inner">
      <a class="brand" href="${isHome ? '#top' : linkTo(route)}" aria-label="GetToken 首页">
        <img class="brand-logo" src="${linkTo(route, 'assets/gettoken/logo.png')}" alt="" width="28" height="28">
        <span class="brand-word">GetToken</span>
      </a>
      <nav class="desktop-nav" aria-label="主导航">
        <details class="nav-products">
          <summary${current === 'product' ? ' class="is-current"' : ''}>产品服务 ${CHEVRON}</summary>
          <div class="nav-dropdown">
            ${products.join('\n            ')}
          </div>
        </details>
        <a href="${anchor(route, 'how')}">购买流程</a>
        <a href="${anchor(route, 'faq')}">常见问题</a>
        <a href="${linkTo(route, VERIFY_ROUTE)}"${mark('verify')}>审核验证${SOON}</a>
        <a href="${linkTo(route, 'guides/')}"${mark('guides')}>AI 指南</a>
      </nav>
      <div class="header-actions">
        ${contactButton('ghost-button')}
        <a class="pill-button" href="${cta.href}">${esc(cta.label)}</a>
        <button class="menu-toggle" type="button" aria-expanded="false" aria-controls="mobile-nav" aria-label="打开菜单"><span></span><span></span></button>
      </div>
    </div>
    <nav class="mobile-nav" id="mobile-nav" aria-label="移动端主导航" hidden>
      <a href="${anchor(route, 'products')}">产品服务</a>
      <a href="${anchor(route, 'how')}">购买流程</a>
      <a href="${anchor(route, 'faq')}">常见问题</a>
      <a href="${linkTo(route, VERIFY_ROUTE)}">审核验证${SOON}</a>
      <a href="${linkTo(route, 'guides/')}">AI 指南</a>
      ${contactButton('')}
    </nav>
  </header>`;
}

export function siteFooter({ route = null, contact = 'dialog' }) {
  const contactLink = contact === 'dialog' ? '<button type="button" data-open-query>联系客服</button>' : `<a href="${anchor(route, 'contact')}">联系客服</a>`;
  return `<footer class="site-footer" id="contact">
    <div class="shell footer-main">
      <div class="footer-brand">
        <a class="brand" href="${route === null ? '#top' : linkTo(route)}"><img class="brand-logo" src="${linkTo(route, 'assets/gettoken/logo.png')}" alt="" width="28" height="28" loading="lazy"><span class="brand-word">GetToken</span></a>
        <p>Codex、Claude、Gemini、Grok 与住宅 IP 一站选购。<br>更好的工具，更自由的创造。</p>
      </div>
      <div class="footer-links">
        <div><span>产品</span>${PRODUCT_PAGES.map(p => `<a href="${linkTo(route, productRoute(p))}">${esc(PRODUCTS[p.slug].name)}</a>`).join('')}</div>
        <div><span>指南</span><a href="${linkTo(route, 'guides/')}">AI 订阅指南</a><a href="${anchor(route, 'news')}">最新动态</a><a href="${linkTo(route, 'guides/basics/')}">选购基础</a><a href="${linkTo(route, FEED_ROUTE)}">RSS 订阅</a></div>
        <div><span>购买</span><a href="${anchor(route, 'products')}">选择产品</a><a href="${anchor(route, 'how')}">购买流程</a><a href="${anchor(route, 'scenes')}">使用场景</a><a href="${linkTo(route, VERIFY_ROUTE)}">审核验证</a></div>
        <div><span>支持</span><a href="${anchor(route, 'faq')}">常见问题</a><a href="${linkTo(route, VERIFY_ROUTE)}#query">审核进度查询</a>${contactLink}</div>
      </div>
    </div>
    <p class="shell footer-note">GetToken 是独立第三方服务品牌，与 OpenAI、Google、xAI、Anthropic 无隶属关系。普通商品按页面受理状态咨询，未确认报价与交付条件前请勿付款；产品权益以当前官方说明与实际账号状态为准。</p>
    <div class="shell footer-bottom"><span>© 2026 GetToken. All rights reserved.</span><span>独立服务品牌 · 非第三方官方平台</span></div>
  </footer>`;
}

// `current` picks the highlighted header item; guide pages add the topic bar under the header.
// `head` adds page-specific stylesheets and scripts; `robots` marks private pages noindex.
function layout({ route, title, description, body, schema, type = 'website', modified, published, prev, next, tone, topic, product, current = product ? 'product' : 'guides', contact = product ? 'dialog' : 'link', head = '', robots = '', buy: buyOverride, tail = '' }) {
  const guide = buyLink(route, topic);
  const cta = buyOverride || (product ? { href: '#plans', label: '选购方案' } : { href: guide.href, label: guide.name ? `购买 ${guide.name}` : '选购产品' });
  const subnav = current === 'guides'
    ? `<nav class="g-subnav" aria-label="指南专题"><div class="g-shell"><a href="${href(route, 'guides/')}"${route === 'guides/' ? ' aria-current="page"' : ''}>全部指南</a>${TOPICS.map(t => `<a href="${href(route, topicRoute(t))}"${route.startsWith(`guides/${t.slug}/`) ? ' aria-current="page"' : topic === t.slug ? ' aria-current="true"' : ''}>${esc(t.name)}</a>`).join('')}</div></nav>\n`
    : '';
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#0b0b10">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
${robots ? `<meta name="robots" content="${robots}">\n` : ''}<link rel="canonical" href="${url(route)}">
${prev ? `<link rel="prev" href="${url(prev)}">\n` : ''}${next ? `<link rel="next" href="${url(next)}">\n` : ''}<meta property="og:type" content="${type}">
<meta property="og:site_name" content="GetToken">
<meta property="og:locale" content="zh_CN">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${url(route)}">
${robots ? '' : shareImageMeta(route)}
${type === 'article' ? `${published ? `<meta property="article:published_time" content="${published}">\n` : ''}<meta property="article:modified_time" content="${modified}">\n` : ''}<link rel="alternate" type="application/rss+xml" title="GetToken AI 订阅指南" href="${href(route, FEED_ROUTE)}">
<link rel="icon" href="${href(route, 'assets/gettoken/favicon.svg')}" type="image/svg+xml">
<link rel="stylesheet" href="${href(route, 'assets/guides/guides.css')}">
<link rel="stylesheet" href="${href(route, 'assets/gettoken/chrome.css')}">
<script type="module" src="${href(route, 'assets/gettoken/chrome.mjs')}"></script>
${product ? `<link rel="stylesheet" href="${href(route, 'assets/gettoken/product.css')}">\n<script type="module" src="${href(route, 'assets/gettoken/product.mjs')}"></script>\n` : ''}${head}<script type="application/ld+json">${json({ '@context': 'https://schema.org', '@graph': [organization, website, ...schema] })}</script>
</head>
<body${tone ? ` data-tone="${tone}"` : ''}>
<a class="g-skip" href="#main">跳到正文</a>
${siteHeader({ route, current, product, cta, contact })}
${subnav}${body}
${siteFooter({ route, contact })}
${tail}</body>
</html>
`;
}

// One article in a list: topic, date, reading time, title and summary.
function row(route, a, heading = 'h3') {
  const t = topicOf(a.topic);
  return `<li class="g-row" data-tone="${t.tone}"><a href="${href(route, articleRoute(a))}"><span class="g-row__meta"><span class="g-chip">${esc(t.name)}</span><span>${a.type === 'news' ? '<b class="g-flag">动态</b> ' : ''}${time(a.updated)} · 约 ${a.minutes} 分钟</span></span><${heading}>${esc(a.title)}</${heading}><p>${esc(a.summary)}</p></a></li>`;
}
function cta(route, topicSlug, heading) {
  const buy = buyLink(route, topicSlug);
  const text = buy.name ? `查看 ${esc(buy.name)} 方案与受理状态，受理开放后先确认资格、报价和交付条件。` : '选择产品，查看方案与受理状态，受理开放后先确认资格、报价和交付条件。';
  return `<aside class="g-cta" aria-label="购买入口"><div><h2>${heading}</h2><p>${text}</p></div><a class="g-btn g-btn--light" href="${buy.href}">${esc(buy.label)}</a></aside>`;
}

function hubPage() {
  const route = 'guides/';
  const start = HUB.startHere.map(slug => ARTICLES.find(a => a.slug === slug));
  const body = `<div class="g-hero"><div class="g-shell">
${crumbNav(route, [['首页', ''], ['AI 订阅指南', route]])}
<div class="g-hero__grid">
<div><p class="g-eyebrow">GetToken 指南</p><h1>${esc(HUB.h1)}</h1><p class="g-lead">${esc(HUB.lead)}</p>
<ul class="g-stats"><li><b>${ARTICLES.length}</b>篇指南</li><li><b>${TOPICS.length}</b>个专题</li><li><b>${HUB_MODIFIED}</b>最近更新</li></ul></div>
<section class="g-start" id="start" aria-labelledby="start-title"><h2 id="start-title">新手先读</h2><ol>${start.map(a => `<li><a href="${href(route, articleRoute(a))}"><strong>${esc(a.title)}</strong><span>${esc(topicOf(a.topic).name)} · 约 ${a.minutes} 分钟</span></a></li>`).join('')}</ol></section>
</div></div></div>
<main id="main" class="g-shell">
<section class="g-section" aria-labelledby="topics-title"><div class="g-section__head"><h2 id="topics-title">按产品浏览</h2><p>每个专题汇总该产品的订阅、充值、代充与续费问题。</p></div>
<div class="g-topics">${TOPICS.map(t => {
    const list = topicArticles(t);
    return `<article class="g-topic" data-tone="${t.tone}"><a class="g-topic__title" href="${href(route, topicRoute(t))}"><span class="g-mark" aria-hidden="true">${esc(t.mark)}</span><h3>${esc(t.name)}</h3></a><p>${esc(t.short)}</p><ul>${list.slice(0, 3).map(a => `<li><a href="${href(route, articleRoute(a))}">${esc(a.title)}</a></li>`).join('')}</ul><a class="g-more" href="${href(route, topicRoute(t))}">全部 ${list.length} 篇 ${esc(t.name)} 指南<span aria-hidden="true"> →</span></a></article>`;
  }).join('')}</div></section>
<section class="g-section" aria-labelledby="latest-title"><div class="g-section__head"><h2 id="latest-title">最近更新</h2><p>按更新时间排列，只在内容有实质变化时更新日期。</p></div>
<ol class="g-list">${ARTICLES.slice(0, 8).map(a => row(route, a)).join('')}</ol></section>
<section class="g-section g-split" id="faq" aria-labelledby="faq-title"><h2 id="faq-title">购买前的常见问题</h2><div class="g-faq">${HUB.faqs.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}</div></section>
<section class="g-section g-split" id="editorial" aria-labelledby="editorial-title"><h2 id="editorial-title">内容与更新原则</h2><div class="g-text">${HUB.editorial.map(p => `<p>${esc(p)}</p>`).join('')}<p class="g-meta">GetToken 编辑部 · 指南更新：${time(HUB_MODIFIED)}</p></div></section>
${cta(route, null, '读完指南，确认适合你的方案')}
</main>`;
  return layout({
    route, title: HUB.title, description: HUB.description, body,
    schema: [crumbList([['首页', ''], ['AI 订阅指南', route]]), {
      '@type': 'CollectionPage', '@id': `${url(route)}#webpage`, url: url(route), name: HUB.h1, description: HUB.description,
      dateModified: HUB_MODIFIED, inLanguage: 'zh-CN', isPartOf: { '@id': website['@id'] }, publisher: { '@id': organization['@id'] },
      mainEntity: { '@type': 'ItemList', name: 'AI 订阅指南专题', itemListElement: TOPICS.map((t, i) => ({ '@type': 'ListItem', position: i + 1, name: t.title, url: url(topicRoute(t)) })) },
    }],
  });
}

function topicPage(t, items, page, pages) {
  const route = topicRoute(t, page);
  const all = topicArticles(t);
  const modified = topicModified(t);
  const suffix = page > 1 ? `（第 ${page} 页）` : '';
  const crumbs = [['首页', ''], ['AI 订阅指南', 'guides/'], [t.name, topicRoute(t)], ...(page > 1 ? [[`第 ${page} 页`, route]] : [])];
  const pager = pages > 1 ? `<nav class="g-pager" aria-label="分页">${page > 1 ? `<a rel="prev" href="${href(route, topicRoute(t, page - 1))}">← 上一页</a>` : ''}<ol>${Array.from({ length: pages }, (_, i) => i + 1).map(n => n === page ? `<li><span aria-current="page">${n}</span></li>` : `<li><a href="${href(route, topicRoute(t, n))}">${n}</a></li>`).join('')}</ol>${page < pages ? `<a rel="next" href="${href(route, topicRoute(t, page + 1))}">下一页 →</a>` : ''}</nav>` : '';
  const body = `<div class="g-hero g-hero--topic"><div class="g-shell">
${crumbNav(route, crumbs)}
<div class="g-topic-hero"><span class="g-mark g-mark--lg" aria-hidden="true">${esc(t.mark)}</span><div>
<p class="g-eyebrow">专题 · ${all.length} 篇指南</p><h1>${esc(t.title)}${suffix}</h1><p class="g-lead">${esc(t.intro)}</p>
<p class="g-meta">GetToken 编辑部 · 更新：${time(modified)}${t.source ? ` · <a href="${esc(t.source[1])}" target="_blank" rel="noopener noreferrer">${esc(t.source[0])} ↗</a>` : ''}</p>
</div></div></div></div>
<main id="main" class="g-shell">
${page === 1 ? `<section class="g-facts" aria-labelledby="facts-title"><h2 id="facts-title">${t.slug === 'basics' ? '选购前先分清' : `${esc(t.name)} 使用前先分清`}</h2><dl>${t.facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl></section>` : ''}
<section class="g-section" aria-labelledby="list-title"><div class="g-section__head"><h2 id="list-title">全部 ${esc(t.name)} 指南</h2><p>共 ${all.length} 篇，本专题文章在前，相关通用指南在后。</p></div>
<ol class="g-list">${items.map(a => row(route, a)).join('')}</ol>${pager}</section>
<nav class="g-section g-others" aria-labelledby="others-title"><h2 id="others-title">其他专题</h2><ul>${TOPICS.filter(o => o !== t).map(o => `<li data-tone="${o.tone}"><a href="${href(route, topicRoute(o))}"><span class="g-mark" aria-hidden="true">${esc(o.mark)}</span>${esc(o.name)}</a></li>`).join('')}</ul></nav>
${cta(route, t.slug, `需要开通 ${esc(t.name)}？`)}
</main>`;
  return layout({
    route, tone: t.tone, topic: t.slug, title: `${t.title}${suffix} - GetToken`,
    description: page > 1 ? `${t.title}第 ${page} 页：${t.description}` : t.description, body,
    prev: page > 1 ? topicRoute(t, page - 1) : null, next: page < pages ? topicRoute(t, page + 1) : null,
    schema: [crumbList(crumbs), {
      '@type': 'CollectionPage', '@id': `${url(route)}#webpage`, url: url(route), name: `${t.title}${suffix}`, description: t.description,
      dateModified: modified, inLanguage: 'zh-CN', isPartOf: { '@id': website['@id'] }, about: { '@type': 'Thing', name: t.name },
      mainEntity: { '@type': 'ItemList', numberOfItems: items.length, itemListElement: items.map((a, i) => ({ '@type': 'ListItem', position: (page - 1) * PAGE_SIZE + i + 1, name: a.title, url: url(articleRoute(a)) })) },
    }],
  });
}

function renderBlocks(route, blocks) {
  const link = (label, address) => {
    if (/^https:\/\//.test(address)) return `<a href="${esc(address)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    if (address.startsWith('/')) return `<a href="${esc(href(route, address.slice(1)))}">${label}</a>`;
    if (address.startsWith('#')) return `<a href="${esc(address)}">${label}</a>`;
    throw new Error(`Links must be https://, /site-path or #fragment: ${address}`);
  };
  const md = text => inline(text, link);
  return blocks.map(b => {
    if (b.type === 'p') return `<p>${md(b.text)}</p>`;
    if (b.type === 'h3') return `<h3>${md(b.text)}</h3>`;
    if (b.type === 'ul' || b.type === 'ol') return `<${b.type}>${b.items.map(i => `<li>${md(i)}</li>`).join('')}</${b.type}>`;
    if (b.type === 'note') return `<p class="g-note">${md(b.text)}</p>`;
    if (b.type === 'table') return `<div class="g-table" role="region" aria-label="表格" tabindex="0"><table><thead><tr>${b.head.map(h => `<th scope="col">${md(h)}</th>`).join('')}</tr></thead><tbody>${b.rows.map(r => `<tr>${r.map((c, i) => i === 0 ? `<th scope="row">${md(c)}</th>` : `<td>${md(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    throw new Error(`Unknown block ${b.type}`);
  }).join('');
}

function relatedFor(a) {
  const picked = a.related.map(slug => ARTICLES.find(x => x.slug === slug));
  for (const x of ARTICLES) if (picked.length < 3 && x !== a && !picked.includes(x) && x.topics.includes(a.topic)) picked.push(x);
  return picked.slice(0, 3);
}

function articlePage(a) {
  const route = articleRoute(a);
  const t = topicOf(a.topic);
  const toc = [...a.sections.map((s, i) => [`section-${i + 1}`, s.title]), ...(a.faqs.length ? [['questions', '常见问题']] : []), ['sources', '资料来源与说明']];
  const tocList = `<ol>${toc.map(([id, label]) => `<li><a href="#${id}">${esc(label)}</a></li>`).join('')}</ol>`;
  const crumbs = [['首页', ''], ['AI 订阅指南', 'guides/'], [t.name, topicRoute(t)], [a.title, route]];
  const body = `<div class="g-shell">${crumbNav(route, crumbs)}</div>
<main id="main" class="g-shell">
<header class="g-article__head"><a class="g-chip g-chip--link" href="${href(route, topicRoute(t))}">${esc(t.name)}</a>${a.type === 'news' ? ' <span class="g-flag">动态</span>' : ''}<h1>${esc(a.title)}</h1><p class="g-lead">${esc(a.summary)}</p>
<p class="g-byline"><img src="${href(route, 'assets/gettoken/logo.png')}" width="20" height="20" alt=""><a href="${href(route, 'guides/')}#editorial">GetToken 编辑部</a><span>更新于 ${time(a.updated)}</span>${a.published ? `<span>发布于 ${time(a.published)}</span>` : ''}<span>约 ${a.minutes} 分钟阅读</span></p></header>
<div class="g-article">
<article class="g-prose">
<details class="g-toc-inline"><summary>本文目录</summary>${tocList}</details>
${a.sections.map((s, i) => `<section id="section-${i + 1}"><h2>${esc(s.title)}</h2>${renderBlocks(route, s.blocks)}</section>`).join('\n')}
${a.faqs.length ? `<section id="questions"><h2>常见问题</h2><div class="g-faq">${a.faqs.map(f => `<details><summary>${esc(f.q)}</summary>${renderBlocks(route, f.a.map(text => ({ type: 'p', text })))}</details>`).join('')}</div></section>` : ''}
<section id="sources" class="g-sources"><h2>资料来源与说明</h2><p>本文由 GetToken 整理，用于购买前核对，不代表相关产品的官方平台或授权说明。功能、资格与价格可能变化，请以当前官方信息和实际账号状态为准。${a.verified ? `公开资料核验：${a.verified}；未在你的账号操作验证。` : ''}</p>${a.sources.length ? `<ul>${a.sources.map(([label, address]) => `<li><a href="${esc(address)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a></li>`).join('')}</ul>` : '<p>交付方式与期限以实际确认的服务清单为准。</p>'}<p>更多相关内容：${a.topics.map(slug => `<a href="${href(route, topicRoute(topicOf(slug)))}">${esc(topicOf(slug).name)} 专题</a>`).join('、')}。</p></section>
</article>
<aside class="g-aside"><nav class="g-toc" aria-label="文章目录"><p>本文目录</p>${tocList}</nav><div class="g-aside__cta"><p>查看方案与受理状态</p><a class="g-btn g-btn--light" href="${buyLink(route, t.slug).href}">${esc(buyLink(route, t.slug).label)}</a></div></aside>
</div>
<section class="g-section" aria-labelledby="related-title"><div class="g-section__head"><h2 id="related-title">继续阅读</h2></div><ol class="g-list g-list--cards">${relatedFor(a).map(x => row(route, x)).join('')}</ol></section>
${cta(route, t.slug, `${t.slug === 'basics' ? '先确认账号、期限与权限' : `查看 ${esc(t.name)} 相关方案`}`)}
</main>`;
  return layout({
    route, tone: t.tone, topic: t.slug, type: 'article', modified: a.updated, published: a.published, title: `${a.title} - GetToken`, description: a.description, body,
    schema: [crumbList(crumbs), {
      '@type': a.type === 'news' ? 'NewsArticle' : 'Article', '@id': `${url(route)}#article`, headline: a.title, description: a.description, url: url(route),
      mainEntityOfPage: url(route), dateModified: a.updated, ...(a.published ? { datePublished: a.published } : {}),
      inLanguage: 'zh-CN', isAccessibleForFree: true, articleSection: t.name,
      author: { '@id': organization['@id'] }, publisher: { '@id': organization['@id'] },
      about: a.topics.map(slug => ({ '@type': 'Thing', name: topicOf(slug).name })), citation: a.sources.map(([, address]) => address),
    }],
  });
}

/* ---------- Product pages ---------- */
const PAY_DIALOGS = `<dialog class="sheet" id="pay-dialog" aria-labelledby="pay-title">
<button class="sheet__close" type="button" data-close-dialog aria-label="关闭">×</button>
<div class="pay">
<div class="pay__summary">
<p class="eyebrow">Plan inquiry</p>
<h2 id="pay-title" data-pay-title>确认你的方案</h2>
<dl class="pay__list" data-pay-list></dl>
<div class="pay__ref"><span>方案参考</span><code data-pay-ref>GT-0000</code><button type="button" data-copy-ref>复制</button></div>
<ol class="pay__steps"><li>确认当前方案是否受理。</li><li>受理开放后先取得书面报价。</li><li>交付与售后以事先确认的约定为准。</li></ol>
</div>
<div class="pay__panel">
<div class="pay__methods" role="tablist" aria-label="支付方式" data-pay-methods></div>
<div class="pay__qr" data-pay-qr></div>
<p class="pay__hint">普通商品不提供站内扫码付款。</p>
<p class="pay__amount"><span>报价状态</span><strong data-pay-amount>待报价</strong><small data-pay-amount-note>金额以客服确认为准</small></p>
<div class="pay__contact" data-pay-contact></div>
</div>
</div>
</dialog>
<dialog class="sheet sheet--small" id="query-dialog" aria-labelledby="query-title">
<button class="sheet__close" type="button" data-close-dialog aria-label="关闭">×</button>
<div class="sheet__body">
<p class="eyebrow">Support</p>
<h2 id="query-title">服务咨询与受理状态</h2>
<p class="sheet__text">普通商品采用人工询价；仅在受理开放后联系支持方，付款前确认交付与售后。</p>
<div class="pay__contact" data-query-contact></div>
<button class="g-btn g-btn--light" type="button" data-close-dialog>好的</button>
</div>
</dialog>
<div class="toast" role="status" aria-live="polite" data-toast></div>
<noscript><p class="noscript-note">启用 JavaScript 后可查看咨询与受理说明；方案和指南仍可正常阅读。</p></noscript>
`;

const PLAN_STYLES = ['a', 'b', 'c'];
const priced = catalog => Object.values(catalog.tiers).some(t => Number.isInteger(t.monthlyMinor));
const refList = catalog => Object.values(catalog.tiers).filter(t => t.ref).map(t => `${t.name} ${t.ref}`).join(' · ');

function planCard(p, catalog, key, i) {
  const tier = catalog.tiers[key];
  const quote = getQuote(p.slug, key, 3, catalog.deliveries ? Object.keys(catalog.deliveries)[0] : null);
  const id = `${p.slug}-${key}`;
  const radios = (name, options, checked, attr) => options.map(([value, label]) => `<label><input type="radio" name="${id}-${name}" value="${value}" ${attr}${value === checked ? ' checked' : ''}><span>${label}</span></label>`).join('');
  const deliveries = catalog.deliveries ? `<fieldset class="choice choice--two"><legend>交付方式</legend><div class="choice__options">${radios('delivery', Object.entries(catalog.deliveries).map(([k, d]) => [k, `<b>${esc(d.name)}</b><small>${esc(d.hint)}</small>`]), quote.delivery, 'data-delivery')}</div></fieldset>` : '';
  return `<article class="plan plan--${PLAN_STYLES[i]}${i === 1 ? ' is-featured' : ''}" id="plan-${key}" data-plan data-product="${p.slug}" data-tier="${key}">${i === 1 ? '<span class="plan__flag">推荐</span>' : ''}
<div class="plan__head"><h3><span class="glyph" aria-hidden="true">${esc(catalog.glyph)}</span>${esc(tier.name)} <em>/ ${esc(tier.hint)}</em></h3><span class="plan__badge">${esc(tier.badge)}</span></div>
<p class="plan__desc">${esc(tier.desc)}</p>
<div class="plan__price"><strong data-price>${formatMoney(quote.monthlyMinor, quote.currency)}</strong><span>/ 月</span><ul class="plan__tags">${tier.features.map(f => `<li>${esc(f)}</li>`).join('')}</ul></div>
<p class="plan__total" data-total>${totalLabel(quote)}</p>
${deliveries}<fieldset class="choice choice--period"><legend>服务周期</legend><div class="choice__options">${radios('period', Object.entries(PERIOD_NAMES), String(quote.months), 'data-period')}</div></fieldset>
<button class="plan__cta" type="button" data-buy>${inquiryState(p.slug, key, quote.months).label}</button>
<p class="plan__note">先核实资格 · 再确认报价 · 按约验收</p>
</article>`;
}

function productPage(p) {
  const route = productRoute(p);
  const catalog = PRODUCTS[p.slug];
  const tiers = Object.keys(catalog.tiers);
  const names = tiers.map(k => catalog.tiers[k].name);
  const articles = productArticles(p);
  const news = articles.filter(a => a.type === 'news').slice(0, 6);
  const guides = articles.filter(a => a.type !== 'news');
  const topic = p.topics.length ? TOPICS.find(t => t.slug === p.topics[0]) : null;
  const verify = guides.find(a => a.slug.endsWith('-verification'));
  const modified = productModified(p);
  const crumbs = [['首页', ''], [catalog.name, route]];
  const refs = refList(catalog);
  const facts = PRODUCT_FACTS[p.slug];
  const brief = [
    refs ? ['官方参考价', `${esc(refs)}<small>${esc(p.source[0])} · 仅供对照</small>`] : ['计价', '按账号地区、规格和供应核实后报价'],
    ['交付方式', catalog.deliveries ? Object.values(catalog.deliveries).map(d => esc(d.name)).join(' · ') : '报价前确认地区、规格与库存'],
    ['服务周期', Object.values(PERIOD_NAMES).join(' · ')],
    ['售后', '受理时确认支持范围与时段'],
  ];
  const guideList = list => `<ol>${list.map(a => `<li><a href="${href(route, articleRoute(a))}"><strong>${esc(a.title)}</strong><span>${esc(topicOf(a.topic).name)} · 约 ${a.minutes} 分钟</span></a></li>`).join('')}</ol>`;
  const allLink = topic ? `<a class="p-more" href="${href(route, topicRoute(topic))}">全部 ${esc(catalog.name)} 动态与指南 →</a>` : '';
  const feed = news.length
    ? `<div class="g-section p-feed">
<section aria-labelledby="news-title"><div class="g-section__head"><h2 id="news-title">${esc(catalog.name)} 最新动态</h2><p>只写会影响购买和使用的变化</p></div>
<ol class="g-list">${news.map(a => row(route, a)).join('')}</ol>${allLink}</section>
${guides.length ? `<aside class="p-guides" aria-labelledby="guides-title"><h2 id="guides-title">选购指南</h2><p>购买前后最常查的问题</p>${guideList(guides.slice(0, 6))}<a class="p-more" href="${href(route, 'guides/')}">全部指南 →</a></aside>` : ''}
</div>`
    : guides.length ? `<section class="g-section" aria-labelledby="guides-title"><div class="g-section__head"><h2 id="guides-title">${esc(catalog.name)} 选购指南</h2><p>购买前后最常查的问题，动态会在这里同步更新</p></div>
<ol class="g-list">${guides.slice(0, 8).map(a => row(route, a)).join('')}</ol>${allLink}</section>` : '';
  const body = `<div class="p-hero"><div class="g-shell">
${crumbNav(route, crumbs)}
<div class="p-hero__grid">
<div>
<div class="p-hero__name"><span class="g-mark g-mark--lg" aria-hidden="true">${esc(catalog.glyph)}</span><div><p class="g-eyebrow">${esc(p.eyebrow)}</p><p class="g-meta">三档：${names.map(esc).join(' / ')}</p></div></div>
<h1>${esc(p.h1)}</h1>
<p class="g-lead">${esc(p.lead)}</p>
<ul class="p-points">${p.points.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
<div class="p-actions"><a class="g-btn g-btn--light" href="#plans">查看三档价格</a><button class="g-btn g-btn--ghost" type="button" data-open-query>微信咨询</button></div>
</div>
<dl class="p-brief">${brief.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
</div></div></div>
<main id="main">
<section class="p-pricing" id="plans" aria-labelledby="plans-title"><div class="g-shell">
<header class="p-pricing__head"><p class="eyebrow">Pricing</p><h2 id="plans-title">${esc(catalog.name)} 三档价格</h2><p class="lead">${names.map(esc).join('、')} 三档，按档位、${catalog.deliveries ? '交付方式与' : ''}周期自由组合。</p></header>
<div class="plans">
${tiers.map((key, i) => planCard(p, catalog, key, i)).join('\n')}
</div>
<p class="footnote"><span class="live-dot" aria-hidden="true"></span>普通商品不提供站内扫码付款；受理状态见各方案按钮。${esc(facts.note)}${facts.checked ? ` 官方资料核验：${facts.checked}。` : ''}${p.source ? `<a href="${esc(p.source[1])}" target="_blank" rel="noopener noreferrer">${refs ? `官方参考价：${esc(refs)}` : esc(p.source[0])} ↗</a>` : ''}</p>
</div></section>
<div class="g-shell">
<section class="g-section" aria-labelledby="steps-title"><div class="g-section__head"><h2 id="steps-title">怎么买、怎么验收</h2></div>
<ol class="p-steps">
<li><h3>选档位与周期</h3><p>先阅读适用条件；所选周期仅表达意向，不代表已确认供应。</p></li>
<li><h3>确认受理状态</h3><p>受理开放后咨询资格、报价、交付期限与售后规则。</p></li>
<li><h3>取得书面确认</h3><p>按支持方登记的询价记录确认交易；未确认前不要付款。</p></li>
<li class="p-steps__check"><h3>${catalog.deliveries ? '在账号里验收' : '确认线路'}</h3><p>${catalog.deliveries ? '核对套餐、有效期与用量。' : '与客服确认地区与线路，接入后测试连通。'}${verify ? ` <a href="${href(route, articleRoute(verify))}">验收方法 →</a>` : ''}</p></li>
</ol></section>
${feed}
<section class="g-section g-split" id="faq" aria-labelledby="faq-title"><h2 id="faq-title">购买 ${esc(catalog.name)} 常见问题</h2><div class="g-faq">${p.faqs.map(([q, a], i) => `<details${i === 0 ? ' open' : ''}><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}</div></section>
<nav class="g-section g-others" aria-labelledby="others-title"><h2 id="others-title">其他产品</h2><ul>${PRODUCT_PAGES.filter(o => o !== p).map(o => `<li data-tone="${o.tone}"><a href="${href(route, productRoute(o))}"><span class="g-mark" aria-hidden="true">${esc(PRODUCTS[o.slug].glyph)}</span>${esc(PRODUCTS[o.slug].name)}</a></li>`).join('')}</ul></nav>
<aside class="g-cta" aria-label="咨询入口"><div><h2>还没想好选哪一档？</h2><p>把你的使用场景发给客服，帮你对照三档${catalog.deliveries ? '用量' : '线路'}后再付款。</p></div><button class="g-btn g-btn--light" type="button" data-open-query>微信咨询</button></aside>
</div>
</main>`;
  return layout({
    route, tone: p.tone, product: p, title: p.title, description: p.description, body, tail: PAY_DIALOGS,
    schema: [crumbList(crumbs), {
      '@type': 'WebPage', '@id': `${url(route)}#webpage`, url: url(route), name: p.h1, description: p.description,
      dateModified: modified, inLanguage: 'zh-CN', isPartOf: { '@id': website['@id'] },
      mainEntity: { '@type': 'Service', name: p.h1, serviceType: catalog.deliveries ? 'AI 订阅代充与独立账号' : '住宅 IP 线路', provider: { '@id': organization['@id'] }, areaServed: 'CN', description: p.description },
    }],
  });
}

/* ---------- /verify/ and its admin page ---------- */
// The page is static; assets/gettoken/verify.mjs talks to the API under /api/verify/.
const VERIFY_TITLE = 'Claude KYC认证：Session Key 提交与进度查询 - GetToken';
const VERIFY_DESCRIPTION = 'GetToken Claude KYC认证协助：提交本人 Session Key，保存私密链接查询人工处理进度。无需填写购买订单号，本站不提供支付，官方身份认证须本人完成。';
const VERIFY_FAQS = [
  ['Claude 官方 KYC需要准备什么？', '官方通过 Persona 验证身份，需要有效的政府签发实体照片证件，可能还需用手机实时自拍。请按 Claude 账户内提示由本人完成；Session Key 是登录凭据，不能替代身份证件或完成官方身份认证。'],
  ['提交需要哪些资料？', '只需填写本人账户的 Session Key 并确认授权，不需要购买订单号或截图，本页不提供支付。'],
  ['提交后什么时候开始处理？', `提交成功后进入人工处理，预计 ${VERIFY.reviewHours} 小时。超时仍显示处理中，不会自动判定通过；官方状态以 Claude 账户显示为准。`],
  ['如何查询已提交的记录？', '原浏览器可使用受理编号或最近提交记录查询；换设备请使用完整私密查询链接。链接请妥善保存，不要公开分享，不要在查询框输入 Session Key。'],
  ['Session Key 提交错了怎么办？', '请保留受理编号，通过已确认的支持渠道申请核实或撤销；不要在聊天中发送完整 Session Key。不得提交他人账户的会话凭据。'],
  ['Session Key 会如何处理？', `Session Key 是登录会话凭据，持有者可能访问你的 Claude 账户。仅在确认协助范围后提交；加密保存，仅授权审核员可查看。出结果 ${VERIFY.purgeDays} 天后删除完整值，仅保留末 4 位。可申请撤销与提前删除，并在 Claude 撤销相关会话。`],
];

function verifyPage() {
  const route = VERIFY_ROUTE;
  const crumbs = [['首页', ''], ['Claude KYC认证', route]];
  const body = `<div class="v-hero"><div class="g-shell">
${crumbNav(route, crumbs)}
<div class="v-hero__text">
<p class="g-eyebrow" data-service-state>Claude KYC认证 · Session Key 提交</p>
<h1>Claude KYC认证</h1>
<p class="g-lead">仅需提交本人 Session Key，即可查询人工处理进度。本站不收款；GetToken 为独立第三方服务，非 Anthropic 官方认证入口。</p>
<ul class="v-facts"><li><b>Session Key</b>仅需填写一项</li><li><b>人工处理</b>提交后进入处理</li><li><b>私密查询</b>保存专属查询链接</li></ul>
</div></div></div>
<main id="main" class="g-shell">
<p class="v-banner" data-mode-banner hidden></p>
<div class="v-main">
<div class="v-primary">
<form class="v-card v-form" id="submit" data-form novalidate aria-labelledby="submit-title">
<h2 class="g-visually-hidden" id="submit-title">提交 Claude KYC认证协助</h2>
<div class="v-step"><span class="v-step__n" aria-hidden="true">1</span><h3><label for="v-code">填写 Session Key</label></h3><div class="v-step__body">
<p class="v-hint" id="v-code-hint" data-service-disclosure>Session Key 是登录会话凭据，持有者可能访问你的账户；不是 API Key 或身份证明。请先确认协助范围，再提交本人账户凭据；格式通过不代表有效。</p>
<div class="v-helper" data-session-helper hidden>
<button class="v-btn v-btn--ghost" type="button" data-session-extract aria-describedby="v-helper-status">获取已登录的 Session Key</button>
<p class="v-hint" id="v-helper-status" data-session-status role="status">测试版：电脑 Chrome / Edge 首次需安装助手；与 Claude 使用同一浏览器资料，无需 F12。</p>
<details class="v-helper__install" data-session-install hidden><summary>安装与使用说明</summary>
<ol><li><a href="${href(route, 'assets/downloads/gettoken-session-helper.zip')}" download>下载助手安装包（开发者模式）</a>，解压到固定目录。</li>
<li>打开 <code>chrome://extensions/</code> 或 <code>edge://extensions/</code>，开启“开发者模式”，点击“加载已解压的扩展程序”，选择含 <code>manifest.json</code> 的目录。</li>
<li>返回并刷新本页，再次点击获取按钮，在扩展窗口确认授权。已登录 Claude 无需重新登录。</li></ol>
<p>助手尚未上架浏览器商店，仅支持电脑普通窗口。不会自动提交；拒绝授权仍可手动填写。若未找到会话，请在同一浏览器资料中打开 Claude 检查登录。</p>
<p><a href="https://github.com/JackNiu2026/GetToken/tree/main/extensions/session-helper" target="_blank" rel="noopener noreferrer">查看助手源码与隐私说明 ↗</a></p></details>
</div>
<div class="v-field"><textarea id="v-code" name="code" rows="3" spellcheck="false" autocomplete="off" autocapitalize="off" maxlength="${VERIFY.codeMax + 40}" aria-describedby="v-code-hint v-code-state" data-code required></textarea>
<div class="v-field__meta"><span id="v-code-state" data-code-state aria-live="polite"></span><span class="v-num" data-code-count>0 位</span></div></div>
</div></div>
<div class="v-step"><span class="v-step__n" aria-hidden="true">2</span><h3>确认授权并提交</h3><div class="v-step__body">
<label class="v-check"><input type="checkbox" name="agree" data-agree><span>我确认账户归本人所有，已了解 Session Key 的访问权限并授权已确认范围内的认证协助。</span></label>
<label class="v-check v-check--soft"><input type="checkbox" name="showPublic" data-show-public><span>本站处理通过后，同意展示打码记录（仅显示 Session Key 末 4 位，不代表官方认证结果）</span></label>
<div class="v-submit"><button class="v-btn v-btn--grad v-btn--block" type="submit" data-submit disabled>正在连接提交服务…</button>
<p class="v-error" data-form-error role="alert" hidden></p>
<p class="v-hint v-center">本页不提供支付。提交后请保存私密查询链接，提交成功后进入人工处理。</p></div>
</div></div>
<noscript><p class="v-error">提交认证协助需要启用 JavaScript。</p></noscript>
</form>
<section class="v-card v-order" id="order" data-order aria-live="polite" hidden></section>
</div>
<div class="v-side">
<aside class="v-card v-feed" aria-labelledby="feed-title" data-feed>
<div class="v-feed__head"><h2 id="feed-title">最新处理通过</h2><div class="v-feed__controls"><span class="v-live">实时</span><button type="button" class="v-feed__toggle" data-feed-toggle aria-pressed="false" aria-label="暂停信息流滚动" hidden>暂停</button></div></div>
<div class="v-feed__stats"><div><b data-stat="passed">—</b><span>今日通过</span></div><div><b data-stat="total-passed">—</b><span>累计通过</span></div></div>
<div class="v-feed__win" data-feed-win tabindex="0" role="region" aria-label="最新通过记录，暂停后可上下滚动"><ul class="v-feed__list" data-feed-list><li class="v-feed__empty">正在加载…</li></ul></div>
<p class="v-feed__foot">仅展示同意公开的本站订单；Session Key 已打码，不代表官方认证结果。</p>
</aside>
<section class="v-card v-query" id="query" aria-labelledby="query-title">
<h2 id="query-title">结果查询</h2><p>在原浏览器输入受理编号，或点击最近提交记录；换设备请粘贴完整私密查询链接。不要在查询框输入 Session Key。</p>
<form data-query><label class="g-visually-hidden" for="v-query-id">受理编号或私密查询链接</label><input id="v-query-id" name="order" placeholder="受理编号 / 私密查询链接" autocomplete="off" spellcheck="false" required><button class="v-btn v-btn--light v-btn--sm" type="submit">查询</button></form>
<p class="v-error" data-query-error role="alert" hidden></p>
<ul class="v-recent" data-recent hidden></ul>
</section>
</div>
</div>
<section class="g-section" id="flow" aria-labelledby="flow-title"><div class="g-section__head"><h2 id="flow-title">认证协助怎么进行</h2><p>本页跟踪本站订单，官方 KYC按 Claude 提示由本人完成。</p></div>
<ol class="v-flow">
<li><em>01</em><h3>提交 Session Key</h3><p>填写本人 Session Key，确认账户归属与授权范围。</p></li>
<li><em>02</em><h3>保存查询链接</h3><p>提交成功后保存受理编号与私密链接，方便后续查询。</p></li>
<li><em>03</em><h3>人工认证协助</h3><p>逐单核对与处理；官方证件和自拍验证须本人完成。</p></li>
<li><em>04</em><h3>查看处理结果</h3><p>使用私密查询链接查看处理结果与说明。</p></li>
</ol></section>
<section class="g-section" id="rules" aria-labelledby="rules-title"><div class="g-section__head"><h2 id="rules-title">提交与售后约定</h2><p>本站仅受理资料与展示处理进度，请在了解访问权限与协助范围后提交。</p></div>
<div class="v-rules">
<div class="v-rule v-rule--keep"><h3><span>本人账户与授权</span></h3><ul><li>仅提交本人账户的 Session Key</li><li>提交前确认协助范围、交付内容与售后约定</li><li>官方证件和自拍认证须本人完成</li></ul></div>
<div class="v-rule v-rule--back"><h3><span>查询与资料保护</span></h3><ul><li>支持时段：9:00–23:00</li><li>保存完整私密链接，跨设备凭链接查询</li><li>不要分享完整 Session Key 或私密查询链接</li></ul></div>
</div></section>
<section class="g-section g-split" id="faq" aria-labelledby="faq-title"><h2 id="faq-title">Claude KYC常见问题</h2><div class="g-faq">${VERIFY_FAQS.map(([q, a], i) => `<details${i === 0 ? ' open' : ''}><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}</div></section>
</main>
<div class="toast" role="status" aria-live="polite" data-toast></div>`;
  return layout({
    route, current: 'verify', title: VERIFY_TITLE, description: VERIFY_DESCRIPTION, body, buy: { href: '#submit', label: '提交认证协助' },
    head: `<link rel="stylesheet" href="${href(route, 'assets/gettoken/verify.css')}?v=helper-20261017">\n<script type="module" src="${href(route, 'assets/gettoken/verify.mjs')}?v=helper-20261017"></script>\n`,
    schema: [crumbList(crumbs), {
      '@type': 'WebPage', '@id': `${url(route)}#webpage`, url: url(route), name: 'Claude KYC认证', description: VERIFY_DESCRIPTION,
      dateModified: VERIFY_UPDATED, inLanguage: 'zh-CN', isPartOf: { '@id': website['@id'] },
      mainEntity: { '@type': 'Service', name: 'Claude KYC认证协助', serviceType: '第三方人工认证协助', provider: { '@id': organization['@id'] }, areaServed: 'CN', description: VERIFY_DESCRIPTION },
    }],
  });
}

function verifyAdminPage() {
  const route = VERIFY_ADMIN_ROUTE;
  const body = `<main id="main" class="g-shell a-main">
<div class="a-top"><h1 class="a-title">审核后台</h1><p class="v-banner" data-mode-banner hidden></p><button class="v-btn v-btn--ghost v-btn--sm" type="button" data-logout hidden>退出登录</button></div>
<form class="v-card a-login" data-login hidden>
<h2>登录</h2><p class="v-hint" data-login-hint>输入在服务器上设置的后台密码。</p>
<label class="g-visually-hidden" for="a-password">后台密码</label><input id="a-password" type="password" name="password" autocomplete="current-password" required placeholder="后台密码">
<button class="v-btn v-btn--light v-btn--block" type="submit">登录</button>
<p class="v-error" data-login-error role="alert" hidden></p>
</form>
<div class="a-app" data-app hidden>
<div class="a-kpis" data-stats></div>
<div class="a-body">
<section class="a-list" aria-label="订单列表">
<div class="a-filters"><div class="a-tabs" role="tablist" aria-label="按状态筛选" data-filters></div>
<form class="a-search" data-search><label class="g-visually-hidden" for="a-q">搜索</label><input id="a-q" name="q" placeholder="受理编号 / 淘宝订单号 / 代码末 4 位" autocomplete="off"></form></div>
<div class="a-table-wrap"><table class="a-table"><thead><tr><th>订单号</th><th>代码</th><th>状态</th><th>核单 / 付款</th><th>剩余</th></tr></thead><tbody data-rows></tbody></table></div>
<div class="a-pager" data-pager></div>
</section>
<aside class="v-card a-detail" data-detail aria-live="polite"><p class="v-hint">点选左侧订单查看详情。</p></aside>
</div>
</div>
</main>
<div class="toast" role="status" aria-live="polite" data-toast></div>`;
  return layout({
    route, current: 'verify', robots: 'noindex, nofollow', title: '审核后台 - GetToken', description: '审核验证订单管理，仅限管理员。', body,
    buy: { href: href(route, VERIFY_ROUTE), label: '返回审核页' },
    head: `<link rel="stylesheet" href="${href(route, 'assets/gettoken/verify.css')}?v=sidebar-20261017">\n<script type="module" src="${href(route, 'assets/gettoken/verify-admin.mjs')}?v=sidebar-20261017"></script>\n`,
    schema: [],
  });
}

/* ---------- Homepage latest block ---------- */
const LATEST_START = '<!-- LATEST:START (generated by scripts/build-site.mjs) -->';
const LATEST_END = '<!-- LATEST:END -->';
function homepage() {
  const html = readFileSync(resolve(ROOT, 'index.html'), 'utf8');
  const start = html.indexOf(LATEST_START);
  const end = html.indexOf(LATEST_END);
  if (start < 0 || end < start) throw new Error('index.html must keep the LATEST:START / LATEST:END markers');
  const items = ARTICLES.slice(0, 3).map(a => {
    const t = topicOf(a.topic);
    return `          <li data-reveal><a class="news-card news-card--${t.tone}" href="./${articleRoute(a)}"><span class="news-card__meta"><b>${esc(t.name)}</b>${a.type === 'news' ? '<span>动态</span>' : ''}<time datetime="${a.updated}">${a.updated}</time></span><h3>${esc(a.title)}</h3><p>${esc(a.summary)}</p><span class="news-card__more">阅读全文 <span aria-hidden="true">→</span></span></a></li>`;
  }).join('\n');
  const withLatest = `${html.slice(0, start + LATEST_START.length)}\n        <ol class="news-grid">\n${items}\n        </ol>\n        ${html.slice(end)}`;
  const header = siteHeader({ route: null, current: 'home', cta: { href: '#products', label: '立即选购' } });
  const homeTitle = html.match(/<title>([^<]+)<\/title>/)[1];
  const homeDescription = html.match(/<meta name="description" content="([^"]+)">/)[1];
  const seo = `<meta property="og:title" content="${homeTitle}">
<meta property="og:description" content="${homeDescription}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="GetToken">
<meta property="og:locale" content="zh_CN">
<meta property="og:url" content="${url('')}">
${shareImageMeta('')}
<script type="application/ld+json">${json({ '@context': 'https://schema.org', '@graph': [organization, website] })}</script>`;
  return between(between(between(withLatest, 'HEADER', header), 'FOOTER', siteFooter({ route: null })), 'SEO', seo);
}

// Replaces what sits between <!-- NAME:START … --> and <!-- NAME:END --> in index.html.
function between(html, name, content) {
  const open = `<!-- ${name}:START (generated by scripts/build-site.mjs) -->`;
  const close = `<!-- ${name}:END -->`;
  const start = html.indexOf(open);
  const end = html.indexOf(close);
  if (start < 0 || end < start) throw new Error(`index.html must keep the ${name}:START / ${name}:END markers`);
  return `${html.slice(0, start + open.length)}\n  ${content}\n  ${html.slice(end)}`;
}

const rfc822 = date => new Date(`${date}T00:00:00+08:00`).toUTCString();
function feed() {
  const items = ARTICLES.slice(0, 50).map(a => `<item><title>${esc(a.title)}</title><link>${url(articleRoute(a))}</link><guid isPermaLink="true">${url(articleRoute(a))}</guid><category>${esc(topicOf(a.topic).name)}</category><pubDate>${rfc822(a.published || a.updated)}</pubDate><description>${esc(a.summary)}</description></item>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
<title>GetToken AI 订阅指南</title>
<link>${url('guides/')}</link>
<description>${esc(HUB.description)}</description>
<language>zh-CN</language>
<lastBuildDate>${rfc822(HUB_MODIFIED)}</lastBuildDate>
<atom:link href="${url(FEED_ROUTE)}" rel="self" type="application/rss+xml"/>
${items}
</channel>
</rss>
`;
}

export function buildOutputs() {
  const outputs = new Map();
  outputs.set('index.html', homepage());
  for (const p of PRODUCT_PAGES) outputs.set(`${productRoute(p)}index.html`, productPage(p));
  outputs.set(`${VERIFY_ROUTE}index.html`, verifyPage());
  outputs.set(`${VERIFY_ADMIN_ROUTE}index.html`, verifyAdminPage());
  outputs.set('guides/index.html', hubPage());
  for (const t of TOPICS) {
    const pages = chunk(topicArticles(t), PAGE_SIZE);
    pages.forEach((items, i) => outputs.set(`${topicRoute(t, i + 1)}index.html`, topicPage(t, items, i + 1, pages.length)));
  }
  for (const a of ARTICLES) outputs.set(`${articleRoute(a)}index.html`, articlePage(a));
  outputs.set(FEED_ROUTE, feed());
  outputs.set('robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${url('sitemap.xml')}\n`);
  outputs.set('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${PAGES.map(p => `  <url><loc>${esc(url(p.route))}</loc>${p.modified ? `<lastmod>${p.modified}</lastmod>` : ''}</url>`).join('\n')}\n</urlset>\n`);
  return outputs;
}

async function filesUnder(dir) {
  const entries = await readdir(resolve(ROOT, dir), { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
  const files = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(path)); else files.push(path);
  }
  return files;
}
async function removeEmptyDirs(dir) {
  const entries = await readdir(resolve(ROOT, dir), { withFileTypes: true }).catch(() => null);
  if (!entries) return;
  for (const entry of entries) if (entry.isDirectory()) await removeEmptyDirs(join(dir, entry.name));
  if (!(await readdir(resolve(ROOT, dir))).length) await rmdir(resolve(ROOT, dir));
}

export async function generateSite({ check = false } = {}) {
  const outputs = buildOutputs();
  const problems = [];
  for (const [name, content] of outputs) {
    let current = null;
    try { current = await readFile(resolve(ROOT, name), 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (current === content) continue;
    if (check) { problems.push(name); continue; }
    await mkdir(dirname(resolve(ROOT, name)), { recursive: true });
    await writeFile(resolve(ROOT, name), content);
  }
  for (const dir of MANAGED_DIRS) for (const file of await filesUnder(dir)) {
    const name = relative(ROOT, resolve(ROOT, file)).split('\\').join('/');
    if (outputs.has(name)) continue;
    if (check) problems.push(`${name} (stale)`); else await rm(resolve(ROOT, name));
  }
  if (!check) for (const dir of MANAGED_DIRS) await removeEmptyDirs(dir);
  if (problems.length) throw new Error(`Generated pages are missing or stale: ${problems.join(', ')}. Run node scripts/build-site.mjs.`);
  return [...outputs.keys()];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = await generateSite({ check: process.argv.includes('--check') });
  console.log(`${process.argv.includes('--check') ? 'Verified' : 'Generated'} ${files.length} files: ${PRODUCT_PAGES.length} product pages, ${ARTICLES.length} articles, ${TOPICS.length} topics, ${ROUTES.length} indexable routes. On the homepage only the latest-articles block is generated.`);
}
