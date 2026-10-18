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
import { PRODUCTS, PERIOD_NAMES, getQuote, formatMoney } from '../assets/gettoken/catalog.mjs';
import { inquiryState } from '../assets/gettoken/inquiry.mjs';
import { VERIFY } from '../assets/gettoken/verify-rules.mjs';
import { KEY_GUIDE_STEPS } from '../content/session-key-guide.mjs';
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
const VERIFY_UPDATED = '2026-10-18';
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
// `current`: 'home' | 'product' | 'verify' | 'guides'; product picks the active product link.
const linkTo = (route, to = '') => (route === null ? `./${to}` : href(route, to));
const anchor = (route, id) => (route === null ? `#${id}` : `${linkTo(route)}#${id}`);
// The order buyers see everywhere (header, footer, product lists): subscriptions first, then 住宅IP.
const SUBSCRIPTIONS = ['claude', 'codex', 'gemini', 'grok'];
const SHOWCASE = [...SUBSCRIPTIONS, 'ip'].map(slug => PRODUCT_PAGES.find(p => p.slug === slug));

export function siteHeader({ route = null, current = 'home', product = null }) {
  const items = [
    ['首页', route === null ? '#top' : linkTo(route), current === 'home'],
    ...SUBSCRIPTIONS.map(slug => [`${PRODUCTS[slug].name}订阅`, linkTo(route, `${slug}/`), product?.slug === slug]),
    ['KYC审核', linkTo(route, VERIFY_ROUTE), current === 'verify'],
    ['住宅IP', linkTo(route, 'ip/'), product?.slug === 'ip'],
    ['AI新闻', linkTo(route, 'guides/'), current === 'guides'],
  ];
  const links = items.map(([label, to, active]) => `<a href="${to}"${active ? ' class="is-current" aria-current="page"' : ''}>${label}</a>`).join('\n        ');
  return `<header class="site-header">
    <div class="shell header-inner">
      <a class="brand" href="${route === null ? '#top' : linkTo(route)}" aria-label="GetToken 首页">
        <img class="brand-logo" src="${linkTo(route, 'assets/gettoken/logo.png')}" alt="" width="28" height="28">
        <span class="brand-word">GetToken</span>
      </a>
      <nav class="desktop-nav" aria-label="主导航">
        ${links}
      </nav>
      <button class="menu-toggle" type="button" aria-expanded="false" aria-controls="mobile-nav" aria-label="打开菜单"><span></span><span></span></button>
    </div>
    <nav class="mobile-nav" id="mobile-nav" aria-label="移动端主导航" hidden>
        ${links}
    </nav>
  </header>`;
}

export function siteFooter({ route = null, contact = 'dialog' }) {
  const contactLink = contact === 'dialog' ? '<button type="button" data-open-query>联系客服</button>' : `<a href="${anchor(route, 'contact')}">联系客服</a>`;
  return `<footer class="site-footer" id="contact">
    <div class="shell footer-main">
      <div class="footer-brand">
        <a class="brand" href="${route === null ? '#top' : linkTo(route)}"><img class="brand-logo" src="${linkTo(route, 'assets/gettoken/logo.png')}" alt="" width="28" height="28" loading="lazy"><span class="brand-word">GetToken</span></a>
        <p>Claude、Codex、Gemini、Grok 订阅与住宅 IP 一站选购。<br>更好的工具，更自由的创造。</p>
      </div>
      <div class="footer-links">
        <div><span>产品</span>${SHOWCASE.map(p => `<a href="${linkTo(route, productRoute(p))}">${p.slug === 'ip' ? '住宅IP' : `${esc(PRODUCTS[p.slug].name)}订阅`}</a>`).join('')}</div>
        <div><span>服务</span><a href="${linkTo(route, VERIFY_ROUTE)}">KYC审核</a><a href="${linkTo(route, VERIFY_ROUTE)}#query">KYC进度查询</a><a href="${anchor(route, 'how')}">购买流程</a><a href="${anchor(route, 'faq')}">常见问题</a>${contactLink}</div>
        <div><span>AI新闻</span><a href="${linkTo(route, 'guides/')}">全部文章</a><a href="${linkTo(route, 'guides/basics/')}">选购基础</a><a href="${linkTo(route, FEED_ROUTE)}">RSS 订阅</a></div>
      </div>
    </div>
    <p class="shell footer-note">GetToken 是独立第三方服务品牌，与 OpenAI、Google、xAI、Anthropic 无隶属关系。普通商品按页面受理状态咨询，未确认报价与交付条件前请勿付款；产品权益以当前官方说明与实际账号状态为准。</p>
    <div class="shell footer-bottom"><span>© 2026 GetToken. All rights reserved.</span><span>独立第三方服务品牌</span></div>
  </footer>`;
}

// The admin page is a tool, not part of the storefront: brand and a way back, no shop links.
function adminHeader(route) {
  return `<header class="site-header site-header--admin">
    <div class="shell header-inner">
      <a class="brand" href="${linkTo(route)}" aria-label="GetToken 首页">
        <img class="brand-logo" src="${linkTo(route, 'assets/gettoken/logo.png')}" alt="" width="28" height="28">
        <span class="brand-word">GetToken</span>
      </a>
      <a class="admin-back" href="${linkTo(route, VERIFY_ROUTE)}">返回 KYC审核页</a>
    </div>
  </header>`;
}

// `current` picks the highlighted header item; guide pages add the topic bar under the header.
// `head` adds page-specific stylesheets and scripts; `robots` marks private pages noindex.
// `admin` swaps the storefront header and footer for the admin header.
function layout({ route, title, description, body, schema, type = 'website', modified, published, prev, next, tone, topic, product, current = product ? 'product' : 'guides', contact = product ? 'dialog' : 'link', head = '', robots = '', tail = '', admin = false }) {
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
<link rel="stylesheet" href="${href(route, 'assets/gettoken/chrome.css')}?v=site-ui-20261018">
<script type="module" src="${href(route, 'assets/gettoken/chrome.mjs')}?v=site-ui-20261018"></script>
${product ? `<link rel="stylesheet" href="${href(route, 'assets/gettoken/product.css')}?v=site-ui-20261018">\n<script type="module" src="${href(route, 'assets/gettoken/product.mjs')}?v=prices-20261018"></script>\n` : ''}${head}<script type="application/ld+json">${json({ '@context': 'https://schema.org', '@graph': [organization, website, ...schema] })}</script>
</head>
<body${tone ? ` data-tone="${tone}"` : ''}>
<a class="g-skip" href="#main">跳到正文</a>
${admin ? adminHeader(route) : siteHeader({ route, current, product })}
${subnav}${body}
${admin ? '' : siteFooter({ route, contact })}
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

const priced = catalog => Object.values(catalog.tiers).some(t => Number.isInteger(t.monthlyMinor));
const monthly = (minor, currency) => (minor === null ? '<span class="is-pending">待报价</span>' : `${formatMoney(minor, currency)}<small> / 月</small>`);
const CHECK = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 8.4 2.6 2.6L12 5.4"/></svg>';

// The purchase panel: one framed block holding every choice (tier and delivery for subscriptions,
// which are billed by the month; tier and intended period for 住宅 IP) and the checkout column, so
// buying never blends into the reading content.
// On phones a bar keeps the selection in view while the checkout column is off screen.
function planPicker(p, catalog) {
  const tiers = Object.keys(catalog.tiers);
  const selected = tiers[0];
  const tier = catalog.tiers[selected];
  const lines = !catalog.deliveries;
  const quote = getQuote(p.slug, selected, lines ? 3 : 1, lines ? null : Object.keys(catalog.deliveries)[0]);
  const state = inquiryState(p.slug, selected, quote.months);
  const facts = PRODUCT_FACTS[p.slug];
  const term = lines ? PERIOD_NAMES[quote.months] : '按月';
  const options = (name, values, checked, attr) => values.map(([value, label]) => `<label><input type="radio" name="${p.slug}-${name}" value="${value}" ${attr}${value === checked ? ' checked' : ''}><span>${label}</span></label>`).join('');
  let step = 1;
  const legend = text => `<legend><span class="p-step__n" aria-hidden="true">${step++}</span>${text}</legend>`;
  const button = state.state === 'inquiry' ? 'g-btn--light' : 'g-btn--ghost';
  return `<section class="p-buy" id="plans" aria-labelledby="plans-title" data-subscription="${p.slug}"><div class="g-shell">
<div class="p-buy__panel">
<div class="p-buy__choices" data-choices>
<header class="p-buy__head"><h2 id="plans-title">${lines ? `选择${esc(catalog.name)} 线路` : `选择 ${esc(catalog.name)} 方案`}</h2><p>两步选好方案${lines ? '' : ' · 按月计费'} · 不需要填写账号资料</p></header>
<fieldset class="p-step" id="plan-options">${legend(lines ? '选择线路' : '选择套餐')}<div class="p-tiers">${tiers.map(key => {
    const item = catalog.tiers[key];
    return `<label class="p-tier"><input type="radio" name="${p.slug}-tier" value="${key}" data-tier-choice${key === selected ? ' checked' : ''}><span class="p-tier__body"><strong class="p-tier__name">${esc(item.name).replace(/（[^）]+）$/, '<small>$&</small>')}</strong><span class="p-tier__hint">${esc(item.hint)}<span class="p-tier__badge">${esc(item.badge)}</span></span><span class="p-tier__price">${monthly(item.monthlyMinor, catalog.currency)}${item.ref ? `<small>官方参考 ${esc(item.ref)}</small>` : ''}</span><span class="p-tier__desc">${esc(item.desc)}</span><span class="p-tier__features">${item.features.map(f => `<span>${CHECK}${esc(f)}</span>`).join('')}</span></span><span class="p-tier__tick" aria-hidden="true">${CHECK}</span></label>`;
  }).join('')}</div></fieldset>
${catalog.deliveries ? `<fieldset class="p-step choice choice--two">${legend('选择交付方式')}<div class="choice__options">${options('delivery', Object.entries(catalog.deliveries).map(([key, d]) => [key, `<b>${esc(d.name)}</b><small>${esc(d.hint)}</small>`]), quote.delivery, 'data-delivery')}</div></fieldset>
` : ''}${lines ? `<fieldset class="p-step choice choice--period">${legend('选择意向周期')}<div class="choice__options">${options('period', Object.entries(PERIOD_NAMES), String(quote.months), 'data-period')}</div></fieldset>
` : ''}<p class="p-buy__fine">${lines ? '周期仅表示需求' : '订阅按单月计费'}，供应与履约须另行确认。${esc(facts.note)}${facts.checked ? ` 官方资料核验：${facts.checked}。` : ''}${p.source ? ` <a href="${esc(p.source[1])}" target="_blank" rel="noopener noreferrer">${esc(p.source[0])} ↗</a>` : ''}</p>
</div>
<div class="p-buy__side">
<aside class="p-checkout" id="selection" aria-labelledby="selection-title">
<p class="p-checkout__state" data-state-badge data-state="${state.state}">${state.label}</p>
<h3 id="selection-title">已选方案</h3>
<p class="p-checkout__name" data-selection-name>${esc(catalog.name)} · ${esc(tier.name)}</p>
<dl class="p-checkout__details">${catalog.deliveries ? `<div><dt>交付方式</dt><dd data-selection-delivery>${esc(quote.deliveryName)}</dd></div>` : ''}<div><dt>${lines ? '意向周期' : '计费方式'}</dt><dd data-selection-period>${term}</dd></div>${priced(catalog) ? `<div><dt>月度报价</dt><dd data-selection-monthly>${formatMoney(quote.monthlyMinor, quote.currency)}</dd></div>` : ''}<div class="p-checkout__total${priced(catalog) ? '' : ' is-pending'}"><dt>${priced(catalog) ? '合计' : '报价'}</dt><dd data-selection-total>${formatMoney(quote.totalMinor, quote.currency)}</dd></div></dl>
<p class="p-sr" role="status" aria-live="polite" data-selection-status data-state="${state.state}">${esc(catalog.name)} · ${esc(tier.name)}${quote.deliveryName ? ` · ${esc(quote.deliveryName)}` : ''} · ${term} · ${state.label}</p>
<button class="g-btn ${button}" type="button" data-inquiry>${state.label} · 查看说明</button>
<p class="p-checkout__note" data-selection-note>${esc(state.message)}</p>
<noscript><p class="p-checkout__note">启用 JavaScript 后可更新摘要并查看受理说明。当前摘要为默认方案；本页不提交订单。</p></noscript>
</aside>
</div>
</div></div>
<div class="p-dock" data-dock hidden><div><strong data-selection-name>${esc(catalog.name)} · ${esc(tier.name)}</strong><span data-dock-meta>${quote.deliveryName ? `${esc(quote.deliveryName)} · ` : ''}${term} · ${state.label}</span></div><a class="g-btn g-btn--light" href="#selection">查看已选</a></div>
</section>`;
}

// A product page is a purchase page: short intro, the purchase panel, how buying works and the
// product's own FAQ. Articles live under /guides/ (AI新闻); the FAQ links to the product's topic.
function productPage(p) {
  const route = productRoute(p);
  const catalog = PRODUCTS[p.slug];
  const guides = productArticles(p).filter(a => a.type !== 'news');
  const topic = p.topics.length ? TOPICS.find(t => t.slug === p.topics[0]) : null;
  const verify = guides.find(a => a.slug.endsWith('-verification'));
  const modified = productModified(p);
  const crumbs = [['首页', ''], [catalog.deliveries ? `${catalog.name}订阅` : '住宅IP', route]];
  const body = `<div class="p-hero"><div class="g-shell">
${crumbNav(route, crumbs)}
<div class="p-hero__head">
<span class="g-mark g-mark--lg" aria-hidden="true">${esc(catalog.glyph)}</span>
<div><p class="g-eyebrow">${esc(p.eyebrow)}</p><h1>${esc(p.h1)}</h1></div>
</div>
<p class="g-lead">${esc(p.lead)}</p>
<ul class="p-points">${p.points.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
</div></div>
<main id="main">
${planPicker(p, catalog)}
<div class="g-shell">
<section class="g-section" id="steps" aria-labelledby="steps-title"><div class="g-section__head"><h2 id="steps-title">办理流程</h2></div>
<ol class="p-steps">
<li><h3>${catalog.deliveries ? '选档位与交付方式' : '选档位与周期'}</h3><p>${catalog.deliveries ? '先阅读适用条件；订阅按单月计费，所选方案不代表已确认供应。' : '先阅读适用条件；所选周期仅表达意向，不代表已确认供应。'}</p></li>
<li><h3>确认受理状态</h3><p>受理开放后咨询资格、报价、交付期限与售后规则。</p></li>
<li><h3>取得书面确认</h3><p>按支持方登记的询价记录确认交易；未确认前不要付款。</p></li>
<li class="p-steps__check"><h3>${catalog.deliveries ? '在账号里验收' : '确认线路'}</h3><p>${catalog.deliveries ? '核对套餐、有效期与用量。' : '与客服确认地区与线路，接入后测试连通。'}${verify ? ` <a href="${href(route, articleRoute(verify))}">验收方法 →</a>` : ''}</p></li>
</ol></section>
<section class="g-section p-faq" id="faq" aria-labelledby="faq-title"><div class="g-section__head"><h2 id="faq-title">${esc(catalog.name)} 常见问题</h2></div><div class="g-faq">${p.faqs.map(([q, a], i) => `<details${i === 0 ? ' open' : ''}><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}</div>${topic ? `<a class="p-more" href="${href(route, topicRoute(topic))}">更多 ${esc(topic.name)} 问题与动态 →</a>` : ''}</section>
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
<ul class="v-facts"><li><b>Session Key</b>仅需填写一项</li><li><b>人工处理</b>预计 ${VERIFY.reviewHours} 小时出结果</li><li><b>私密查询</b>保存专属查询链接</li></ul>
</div></div></div>
<main id="main" class="g-shell">
<p class="v-banner" data-mode-banner hidden></p>
<div class="v-main">
<div class="v-primary">
<form class="v-card v-form" id="submit" data-form novalidate aria-labelledby="submit-title">
<h2 class="g-visually-hidden" id="submit-title">提交 Claude KYC认证协助</h2>
<div class="v-step"><span class="v-step__n" aria-hidden="true">1</span><h3><label for="v-code">填写 Session Key</label></h3><div class="v-step__body">
<p class="v-hint" id="v-code-hint" data-service-disclosure>Session Key 是登录会话凭据，持有者可能访问你的账户；不是 API Key 或身份证明。请先确认协助范围，再提交本人账户凭据；格式通过不代表有效。</p>
<div class="v-helper">
<button class="v-btn v-btn--ghost" type="button" data-key-guide-open aria-haspopup="dialog" aria-controls="key-guide">查看 Session Key 获取教程</button>
<p class="v-hint">30 秒动画演示 · 电脑 Chrome / Edge 操作 · 无需安装扩展</p>
</div>
<div class="v-field"><textarea id="v-code" name="code" rows="3" placeholder="粘贴完整 Session Key，以 sk- 开头" spellcheck="false" autocomplete="off" autocapitalize="off" maxlength="${VERIFY.codeMax + 40}" aria-describedby="v-code-hint v-code-state" data-code required></textarea>
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
<dialog class="v-guide" id="key-guide" data-key-guide-dialog aria-labelledby="key-guide-title" aria-describedby="key-guide-note">
<div class="v-guide__head"><div><h2 id="key-guide-title">如何找到 Session Key</h2><p id="key-guide-note">动画使用虚构界面与示例值，不会读取或复制你的 Cookie。</p></div><button class="v-btn v-btn--ghost" type="button" data-guide-close>关闭</button></div>
<div class="v-guide__body">
<video data-key-guide-video controls playsinline muted preload="none" width="1280" height="900" poster="${href(route, 'assets/gettoken/session-key-guide.png')}" aria-label="Session Key 获取教程，约 30 秒">
<source src="${href(route, 'assets/gettoken/session-key-guide.mp4')}" type="video/mp4"><track kind="captions" src="${href(route, 'assets/gettoken/session-key-guide.vtt')}" srclang="zh" label="简体中文">
你的浏览器暂不支持播放。请按下方文字步骤操作，或下载视频观看。</video>
<p class="v-guide__status" data-key-guide-status role="status" aria-live="polite">可暂停、全屏观看，也可选择下方步骤跳转。</p>
<ol class="v-guide__chapters" aria-label="跳转教程步骤">${KEY_GUIDE_STEPS.map((step, index) => `<li><button type="button" data-guide-jump="${step.start}" data-guide-title="${esc(step.title)}">${index + 1} ${esc(step.short)}</button></li>`).join('')}</ol>
<details class="v-guide__transcript" data-key-guide-transcript><summary>查看文字步骤与 Mac 快捷键</summary><ol>${KEY_GUIDE_STEPS.map(step => `<li><strong>${esc(step.title)}</strong><p>${esc(step.text)}</p></li>`).join('')}</ol></details>
<p class="v-guide__note">只复制本人账号的完整 Value，不要复制 sessionKeyLC，不要照抄动画示例。Session Key 是登录凭据，请勿公开分享。</p>
<div class="v-guide__foot"><a href="${href(route, 'assets/gettoken/session-key-guide.mp4')}" download>下载动画视频</a><div><button class="v-btn v-btn--ghost" type="button" data-guide-replay>重播动画</button><button class="v-btn v-btn--light" type="button" data-guide-fill>返回填写</button></div></div>
</div></dialog>
<div class="toast" role="status" aria-live="polite" data-toast></div>`;
  return layout({
    route, current: 'verify', title: VERIFY_TITLE, description: VERIFY_DESCRIPTION, body,
    head: `<link rel="stylesheet" href="${href(route, 'assets/gettoken/verify.css')}?v=verify-support-20261018">\n<script type="module" src="${href(route, 'assets/gettoken/verify.mjs')}?v=verify-support-20261018"></script>\n`,
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
<div class="a-top"><h1 class="a-title">KYC审核后台</h1><p class="v-banner" data-mode-banner hidden></p><button class="v-btn v-btn--ghost v-btn--sm" type="button" data-logout hidden>退出登录</button></div>
<form class="v-card a-login" data-login hidden>
<h2>管理员登录</h2><p class="v-hint" data-login-hint>输入在服务器上设置的后台密码。</p>
<label class="g-visually-hidden" for="a-password">后台密码</label><input id="a-password" type="password" name="password" autocomplete="current-password" required placeholder="后台密码">
<button class="v-btn v-btn--light v-btn--block" type="submit">登录</button>
<p class="v-error" data-login-error role="alert" hidden></p><details class="a-login-help"><summary>首次登录或忘记密码？</summary><p class="v-hint">在服务器终端运行 <code>sudo gettoken-verify passwd</code> 设置新密码（至少 12 位）。此操作会退出已有登录，不影响提交记录。</p></details>
</form>
<div class="a-app" data-app hidden>
<div class="a-toolbar"><p class="v-hint">点选提交查看 Session Key，填写审核说明后保存结果。预计审核时长 ${VERIFY.reviewHours} 小时。</p><button class="v-btn v-btn--ghost v-btn--sm" type="button" data-admin-refresh>刷新提交</button></div>
<p class="v-error" role="alert" data-admin-error hidden></p>
<div class="a-kpis" data-stats></div>
<div class="a-body">
<section class="a-list" aria-label="提交列表">
<div class="a-filters"><div class="a-tabs" role="group" aria-label="按状态筛选" data-filters></div>
<form class="a-search" data-search><label class="g-visually-hidden" for="a-q">搜索</label><input id="a-q" name="q" data-search-input placeholder="受理编号 / Session Key 末 4 位" autocomplete="off"><button class="v-btn v-btn--ghost v-btn--sm" type="submit">搜索</button></form></div>
<div class="a-table-wrap"><table class="a-table"><thead><tr><th>受理编号</th><th>Session Key</th><th>状态</th><th>提交时间</th><th>预计剩余</th></tr></thead><tbody data-rows></tbody></table></div>
<div class="a-pager" data-pager></div>
</section>
<aside class="v-card a-detail" data-detail aria-live="polite"><p class="v-hint">点选提交查看详情并录入审核结果。</p></aside>
</div>
</div>
</main>
<div class="toast" role="status" aria-live="polite" data-toast></div>`;
  return layout({
    route, current: 'verify', admin: true, robots: 'noindex, nofollow', title: 'KYC审核后台 - GetToken', description: 'KYC审核提交管理，仅限管理员。', body,
    head: `<link rel="stylesheet" href="${href(route, 'assets/gettoken/verify.css')}?v=verify-support-20261018">\n<script type="module" src="${href(route, 'assets/gettoken/verify-admin.mjs')}?v=review-admin-20261018"></script>\n`,
    schema: [],
  });
}

/* ---------- 404 ---------- */
// Served by the web server for any missing address, so every link is absolute from the site root.
function notFoundPage() {
  const body = `<main id="main" class="g-shell g-missing">
<p class="g-eyebrow">404</p>
<h1>页面不存在或已移动</h1>
<p class="g-lead">请检查网址，或从下面的入口继续。</p>
<ul class="g-missing__links">${SUBSCRIPTIONS.map(slug => `<li><a href="${slug}/">${esc(PRODUCTS[slug].name)}订阅</a></li>`).join('')}<li><a href="${VERIFY_ROUTE}">KYC审核</a></li><li><a href="ip/">住宅IP</a></li><li><a href="guides/">AI新闻</a></li></ul>
<a class="g-btn g-btn--light" href="">返回首页</a>
</main>`;
  return layout({ route: '', current: null, robots: 'noindex', title: '页面不存在 - GetToken', description: '你访问的页面不存在或已移动。', body, schema: [] })
    .replace(/<link rel="canonical"[^>]*>\n/, '')
    .replace(/<meta property="og:url"[^>]*>\n/, '')
    .replace(/<link rel="alternate"[^>]*>\n/, '')
    .replace(/(href|src)="(?!https?:|#|\/|mailto:)([^"]*)"/g, '$1="/$2"')
    .replace(/href="#(?!main")/g, 'href="/#');
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
  const header = siteHeader({ route: null, current: 'home' });
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
  // The hero says plainly whether anything is taking inquiries yet (site.config.mjs).
  const accepting = PRODUCT_PAGES.some(p => Object.keys(PRODUCTS[p.slug].tiers).some(tier => [1, 3, 12].some(months => inquiryState(p.slug, tier, months).state === 'inquiry')));
  const status = accepting
    ? '<span><i class="dot dot--open" aria-hidden="true"></i>部分方案已开放咨询，付款前先确认报价与交付</span>'
    : '<span><i class="dot" aria-hidden="true"></i>当前暂未受理，可先查看方案与价格</span>';
  return between(between(between(between(withLatest, 'HEADER', header), 'FOOTER', siteFooter({ route: null })), 'SEO', seo), 'STATUS', status);
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
  outputs.set('404.html', notFoundPage());
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
