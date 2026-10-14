#!/usr/bin/env node
// Generates the product pages (/codex/, /claude/ …), the /guides/ library (hub, topic pages,
// articles), robots.txt, sitemap.xml and the RSS feed. On the homepage it only refreshes the
// block between the LATEST markers in index.html; everything else there is hand-written.
import { readFileSync } from 'node:fs';
import { readFile, writeFile, mkdir, readdir, rm, rmdir } from 'node:fs/promises';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITE } from '../content/site.mjs';
import { TOPICS } from '../content/topics.mjs';
import { HUB } from '../content/hub.mjs';
import { PRODUCT_PAGES } from '../content/products.mjs';
import { PRODUCTS, PERIOD_NAMES, getQuote, formatMoney, totalLabel } from '../assets/gettoken/catalog.mjs';
import { VERIFY, yuan, totalMinor } from '../assets/gettoken/verify-rules.mjs';
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
const VERIFY_UPDATED = '2026-10-14';
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

// `product` pages and the /verify/ section share the store navigation; guide pages list topics.
// `head` adds page-specific stylesheets and scripts; `robots` marks private pages noindex.
function layout({ route, title, description, body, schema, type = 'website', modified, published, prev, next, tone, topic, product, store = !!product, head = '', robots = '', buy: buyOverride, tail = '' }) {
  const verifyCurrent = route.startsWith(VERIFY_ROUTE);
  const nav = store
    ? `${PRODUCT_PAGES.map(p => `<a href="${href(route, productRoute(p))}"${p === product ? ' aria-current="page"' : ''}>${esc(PRODUCTS[p.slug].name)}</a>`).join('')}<a href="${href(route, VERIFY_ROUTE)}"${verifyCurrent ? ' aria-current="page"' : ''}>审核验证</a><a href="${href(route, 'guides/')}">AI 指南</a>`
    : TOPICS.map(t => `<a href="${href(route, topicRoute(t))}"${route.startsWith(`guides/${t.slug}/`) ? ' aria-current="page"' : ''}>${esc(t.name)}</a>`).join('');
  const buy = buyOverride || (product ? { href: '#plans', label: '选购方案' } : buyLink(route, topic));
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
<meta name="twitter:card" content="summary">
${type === 'article' ? `${published ? `<meta property="article:published_time" content="${published}">\n` : ''}<meta property="article:modified_time" content="${modified}">\n` : ''}<link rel="alternate" type="application/rss+xml" title="GetToken AI 订阅指南" href="${href(route, FEED_ROUTE)}">
<link rel="icon" href="${href(route, 'assets/gettoken/favicon.svg')}" type="image/svg+xml">
<link rel="stylesheet" href="${href(route, 'assets/guides/guides.css')}">
${product ? `<link rel="stylesheet" href="${href(route, 'assets/gettoken/product.css')}">\n<script type="module" src="${href(route, 'assets/gettoken/product.mjs')}"></script>\n` : ''}${head}<script type="application/ld+json">${json({ '@context': 'https://schema.org', '@graph': [organization, website, ...schema] })}</script>
</head>
<body${tone ? ` data-tone="${tone}"` : ''}>
<a class="g-skip" href="#main">跳到正文</a>
<header class="g-header"><div class="g-shell g-header__row">
<a class="g-brand" href="${href(route)}"><img src="${href(route, 'assets/gettoken/logo.png')}" width="28" height="28" alt=""><span>GetToken</span></a>
${store ? '' : `<a class="g-brand__section${route === 'guides/' ? ' is-current' : ''}" href="${href(route, 'guides/')}"${route === 'guides/' ? ' aria-current="page"' : ''}>指南</a>\n`}<nav class="g-nav" aria-label="${store ? '产品' : '指南专题'}">${nav}</nav>
<a class="g-btn g-btn--light g-header__cta" href="${buy.href}">${store ? buy.label : buy.name ? `购买 ${esc(buy.name)}` : '选购产品'}</a>
</div></header>
${body}
<footer class="g-footer"><div class="g-shell">
<div class="g-footer__grid">
<div class="g-footer__brand"><a class="g-brand" href="${href(route)}"><img src="${href(route, 'assets/gettoken/logo.png')}" width="24" height="24" alt="" loading="lazy"><span>GetToken</span></a><p>好工具，让想法更进一步。扫码付款，人工核对交付，售后有人跟进；购买前可先读 AI 订阅指南。</p></div>
<nav aria-label="产品"><h2>产品</h2><ul>${PRODUCT_PAGES.map(p => `<li><a href="${href(route, productRoute(p))}">${esc(PRODUCTS[p.slug].name)}</a></li>`).join('')}</ul></nav>
<nav aria-label="指南"><h2>指南</h2><ul><li><a href="${href(route, 'guides/')}">AI 订阅指南</a></li><li><a href="${href(route, 'guides/')}#start">新手先读</a></li><li><a href="${href(route, 'guides/')}#editorial">内容与更新原则</a></li><li><a href="${href(route, FEED_ROUTE)}">RSS 订阅</a></li></ul></nav>
<nav aria-label="购买"><h2>购买</h2><ul><li><a href="${href(route)}#how">购买流程</a></li><li><a href="${href(route, VERIFY_ROUTE)}">审核验证</a></li><li><a href="${href(route)}#faq">购买常见问题</a></li><li><a href="${href(route)}">返回首页</a></li></ul></nav>
</div>
<p class="g-footer__note">GetToken 是独立第三方服务品牌，与 OpenAI、Google、xAI、Anthropic 无隶属关系。具体可售方案、价格与交付条件以付款页和客服确认为准；产品权益以当前官方说明与实际账号状态为准。</p>
</div></footer>
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
  const text = buy.name ? `查看 ${esc(buy.name)} 三档价格与扫码购买说明，付款前与客服确认报价和交付条件。` : '选择产品，查看三档价格与扫码购买说明，付款前与客服确认报价和交付条件。';
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
${page === 1 ? `<section class="g-facts" aria-labelledby="facts-title"><h2 id="facts-title">购买 ${esc(t.name)} 前先分清</h2><dl>${t.facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl></section>` : ''}
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
<section id="sources" class="g-sources"><h2>资料来源与说明</h2><p>本文由 GetToken 整理，用于购买前核对，不代表相关产品的官方平台或授权说明。功能、资格与价格可能变化，请以当前官方信息和实际账号状态为准。</p>${a.sources.length ? `<ul>${a.sources.map(([label, address]) => `<li><a href="${esc(address)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a></li>`).join('')}</ul>` : '<p>交付方式与期限以实际确认的服务清单为准。</p>'}<p>更多相关内容：${a.topics.map(slug => `<a href="${href(route, topicRoute(topicOf(slug)))}">${esc(topicOf(slug).name)} 专题</a>`).join('、')}。</p></section>
</article>
<aside class="g-aside"><nav class="g-toc" aria-label="文章目录"><p>本文目录</p>${tocList}</nav><div class="g-aside__cta"><p>想直接开通？</p><a class="g-btn g-btn--light" href="${buyLink(route, t.slug).href}">${esc(buyLink(route, t.slug).label)}</a></div></aside>
</div>
<section class="g-section" aria-labelledby="related-title"><div class="g-section__head"><h2 id="related-title">继续阅读</h2></div><ol class="g-list g-list--cards">${relatedFor(a).map(x => row(route, x)).join('')}</ol></section>
${cta(route, t.slug, `准备好开通 ${esc(t.name)} 了吗？`)}
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
<p class="eyebrow">Confirm &amp; pay</p>
<h2 id="pay-title" data-pay-title>确认你的方案</h2>
<dl class="pay__list" data-pay-list></dl>
<div class="pay__ref"><span>付款备注码</span><code data-pay-ref>GT-0000</code><button type="button" data-copy-ref>复制</button></div>
<ol class="pay__steps"><li>使用收款码完成付款，并在备注中填写付款备注码。</li><li>将付款截图与备注码发送给客服。</li><li>人工核对完成后为你交付，售后全程跟进。</li></ol>
</div>
<div class="pay__panel">
<div class="pay__methods" role="tablist" aria-label="支付方式" data-pay-methods></div>
<div class="pay__qr" data-pay-qr></div>
<p class="pay__hint">电脑端可直接扫码；在手机上可截图保存，再到 App 中从相册识别。</p>
<p class="pay__amount"><span>应付金额</span><strong data-pay-amount>¥XX</strong><small data-pay-amount-note>金额以客服确认为准</small></p>
<div class="pay__contact" data-pay-contact></div>
</div>
</div>
</dialog>
<dialog class="sheet sheet--small" id="query-dialog" aria-labelledby="query-title">
<button class="sheet__close" type="button" data-close-dialog aria-label="关闭">×</button>
<div class="sheet__body">
<p class="eyebrow">Support</p>
<h2 id="query-title">微信咨询与订单查询</h2>
<p class="sheet__text">说说你的使用场景，客服帮你对照档位；已付款的话，把付款备注码发给客服即可查询进度。</p>
<div class="pay__contact" data-query-contact></div>
<button class="g-btn g-btn--light" type="button" data-close-dialog>好的</button>
</div>
</dialog>
<div class="toast" role="status" aria-live="polite" data-toast></div>
<noscript><p class="noscript-note">启用 JavaScript 后可打开扫码付款窗口；价格与购买说明仍可正常阅读。</p></noscript>
`;

const PLAN_STYLES = ['a', 'b', 'c'];
const priced = catalog => Object.values(catalog.tiers).some(t => Number.isInteger(t.monthlyMinor));
const refList = catalog => Object.values(catalog.tiers).filter(t => t.ref).map(t => `${t.name} ${t.ref.replace(/\/月$/, '')}`).join(' · ');

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
<button class="plan__cta" type="button" data-buy>扫码购买</button>
<p class="plan__note">扫码付款 · 人工核对 · 售后跟进</p>
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
  const brief = [
    refs ? ['官方参考价', `${esc(refs)} / 月<small>${esc(p.source[0])} · 仅供对照</small>`] : ['计价', `${catalog.currency === 'USD' ? '美元' : '人民币'}，按线路与周期计算`],
    ['交付方式', catalog.deliveries ? Object.values(catalog.deliveries).map(d => esc(d.name)).join(' · ') : '付款后与客服确认地区与线路'],
    ['服务周期', Object.values(PERIOD_NAMES).join(' · ')],
    ['售后', '有效期内人工跟进'],
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
<p class="footnote"><span class="live-dot" aria-hidden="true"></span>${priced(catalog) ? '' : '价格即将公布，'}下单金额以付款页与客服确认为准。${p.source ? `<a href="${esc(p.source[1])}" target="_blank" rel="noopener noreferrer">${refs ? `官方参考价：${esc(refs)} / 月` : esc(p.source[0])} ↗</a>` : ''}</p>
</div></section>
<div class="g-shell">
<section class="g-section" aria-labelledby="steps-title"><div class="g-section__head"><h2 id="steps-title">怎么买、怎么验收</h2></div>
<ol class="p-steps">
<li><h3>选档位与周期</h3><p>拿不准就先选入门档月付，之后随时可以升级。</p></li>
<li><h3>扫码付款</h3><p>付款时在备注里填写页面给出的备注码。</p></li>
<li><h3>人工核对交付</h3><p>把付款凭证发给客服，核对后开通或交付。</p></li>
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
const VERIFY_TITLE = '审核验证：提交代码，查看人工审核结果 - GetToken';
const VERIFY_DESCRIPTION = `GetToken 审核验证：填写以 sk 开头的代码并在线付款，审核员人工审核，${VERIFY.reviewHours} 小时内出结果。人工技术费 ${yuan(VERIFY.techFeeMinor)} 不退，审核费 ${yuan(VERIFY.auditFeeMinor)} 未通过时 ${VERIFY.refundHours} 小时内原路退回。`;
const VERIFY_FAQS = [
  ['倒计时结束了还没有结果？', `倒计时按付款时间加 ${VERIFY.reviewHours} 小时计算，只是预计时间。个别订单需要更久时，页面会显示「仍在审核中」，结果出来后本页自动更新。`],
  ['关掉页面会影响审核吗？', '不会。审核在后台进行，本机会记住你最近的订单；换了设备也可以输入订单号查询进度和结果。结果只在本页显示，不会另外发短信或邮件。'],
  ['审核费怎么退？', `未通过的订单，审核费 ${yuan(VERIFY.auditFeeMinor)} 在出结果后 ${VERIFY.refundHours} 小时内原路退回到付款账户；人工技术费 ${yuan(VERIFY.techFeeMinor)} 不退。退款进度在结果里可以看到。`],
  ['代码提交错了怎么办？', '付款前请仔细核对。代码提交后不能修改，如需更正请重新提交一单；已付款的订单请联系客服处理。'],
  ['提交的代码会保存多久？', '代码加密保存，只有审核员在后台能看到。出结果 7 天后自动删除，之后只保留末 4 位用于查询。'],
];

function verifyPage() {
  const route = VERIFY_ROUTE;
  const crumbs = [['首页', ''], ['审核验证', route]];
  const tech = yuan(VERIFY.techFeeMinor);
  const audit = yuan(VERIFY.auditFeeMinor);
  const total = yuan(totalMinor());
  const body = `<div class="v-hero"><div class="g-shell">
${crumbNav(route, crumbs)}
<div class="v-hero__text">
<p class="g-eyebrow">审核验证 · 人工审核</p>
<h1>提交代码，查看审核结果</h1>
<p class="g-lead">填写你的代码并在线付款，审核员逐单人工审核，${VERIFY.reviewHours} 小时内出结果。审核中可以看到预计剩余时间，通过或未通过都在本页显示；未通过的订单自动退回审核费。</p>
<ul class="v-facts"><li><b>${tech}</b>人工技术费 · 不退</li><li><b>${audit}</b>审核费 · 未通过退</li><li><b>${VERIFY.reviewHours} 小时</b>内出结果</li></ul>
</div></div></div>
<main id="main" class="g-shell">
<p class="v-banner" data-mode-banner hidden></p>
<div class="v-main">
<div class="v-primary">
<form class="v-card v-form" id="submit" data-form novalidate aria-labelledby="submit-title">
<h2 class="g-visually-hidden" id="submit-title">提交审核</h2>
<div class="v-step"><span class="v-step__n" aria-hidden="true">1</span><h3><label for="v-code">填写审核代码</label></h3><div class="v-step__body">
<p class="v-hint" id="v-code-hint">粘贴完整代码：以 sk 开头，字母、数字与符号组合，约 ${VERIFY.codeMin}–${VERIFY.codeMax} 位。提交后不能修改，请先核对。</p>
<div class="v-field"><textarea id="v-code" name="code" rows="3" spellcheck="false" autocomplete="off" autocapitalize="off" maxlength="${VERIFY.codeMax + 40}" aria-describedby="v-code-hint v-code-state" data-code required></textarea>
<div class="v-field__meta"><span id="v-code-state" data-code-state aria-live="polite"></span><span class="v-num" data-code-count>0 位</span></div></div>
</div></div>
<div class="v-step"><span class="v-step__n" aria-hidden="true">2</span><h3>确认费用</h3><div class="v-step__body">
<div class="v-fees">
<div class="v-fee"><b>人工技术费<span class="v-tag v-tag--rose">不退</span></b><span>人工核对与提交，提交后即产生成本</span><strong>${tech}</strong></div>
<div class="v-fee"><b>审核费<span class="v-tag v-tag--green">未通过可退</span></b><span>审核未通过时，${VERIFY.refundHours} 小时内原路退回</span><strong>${audit}</strong></div>
<div class="v-fee v-fee--total"><b>合计</b><span>未通过时实际支出 ${tech}</span><strong>${total}</strong></div>
</div>
<label class="v-check"><input type="checkbox" name="agree" data-agree><span>我已了解：技术费 ${tech} 不退；审核费 ${audit} 仅在未通过时退回。</span></label>
<label class="v-check v-check--soft"><input type="checkbox" name="showPublic" data-show-public><span>通过后，同意以打码形式出现在「最新通过」列表（只显示代码末 4 位）</span></label>
</div></div>
<div class="v-step"><span class="v-step__n" aria-hidden="true">3</span><h3>选择付款方式</h3><div class="v-step__body">
<div class="v-channels" role="radiogroup" aria-label="付款方式" data-channels><p class="v-hint">正在读取可用的付款方式…</p></div>
<div class="v-submit"><button class="v-btn v-btn--grad v-btn--block" type="submit" data-submit>付款并提交审核 · ${total}</button>
<p class="v-error" data-form-error role="alert" hidden></p>
<p class="v-hint v-center">在线付款，到账后自动开始审核计时。</p></div>
</div></div>
<noscript><p class="v-error">提交审核需要启用 JavaScript。</p></noscript>
</form>
<section class="v-card v-order" id="order" data-order aria-live="polite" hidden></section>
</div>
<div class="v-side">
<aside class="v-card v-feed" aria-labelledby="feed-title" data-feed>
<div class="v-feed__head"><h2 id="feed-title">最新通过</h2><span class="v-live">实时</span></div>
<div class="v-feed__stats"><div><b data-stat="processed">—</b><span>今日处理</span></div><div><b data-stat="passed">—</b><span>今日通过</span></div></div>
<div class="v-feed__win" data-feed-win><ul class="v-feed__list" data-feed-list><li class="v-feed__empty">正在加载…</li></ul></div>
<p class="v-feed__foot">只展示真实通过、且本人同意展示的订单，代码已打码。</p>
</aside>
<section class="v-card v-query" id="query" aria-labelledby="query-title">
<h2 id="query-title">已经提交过？</h2><p>输入订单号，查看审核进度与结果。</p>
<form data-query><label class="g-visually-hidden" for="v-query-id">订单号</label><input id="v-query-id" name="order" placeholder="例如 GT-VF-1014-7KQ2AB" autocomplete="off" spellcheck="false" required><button class="v-btn v-btn--light v-btn--sm" type="submit">查询</button></form>
<p class="v-error" data-query-error role="alert" hidden></p>
<ul class="v-recent" data-recent hidden></ul>
</section>
</div>
</div>
<section class="g-section" id="flow" aria-labelledby="flow-title"><div class="g-section__head"><h2 id="flow-title">审核怎么进行</h2><p>从提交到出结果，每一步都能在本页看到。</p></div>
<ol class="v-flow">
<li><em>01</em><h3>填写并付款</h3><p>填写代码，确认费用，用支付宝或微信在线付款。</p></li>
<li><em>02</em><h3>自动确认到账</h3><p>付款成功后订单立即进入审核，开始 ${VERIFY.reviewHours} 小时倒计时。</p></li>
<li><em>03</em><h3>人工审核</h3><p>审核员逐单处理，页面显示预计剩余时间。</p></li>
<li><em>04</em><h3>查看结果</h3><p>通过显示恭喜通过；未通过显示原因，并自动退回审核费。</p></li>
</ol></section>
<section class="g-section" id="rules" aria-labelledby="rules-title"><div class="g-section__head"><h2 id="rules-title">费用与退款规则</h2><p>付款前请确认，提交即视为同意以下规则。</p></div>
<div class="v-rules">
<div class="v-rule v-rule--keep"><h3><span>人工技术费 <span class="v-tag v-tag--rose">不退</span></span><strong>${tech}</strong></h3><ul><li>用于人工核对、整理与提交</li><li>提交后即产生成本，无论结果如何都不退</li></ul></div>
<div class="v-rule v-rule--back"><h3><span>审核费 <span class="v-tag v-tag--green">未通过可退</span></span><strong>${audit}</strong></h3><ul><li>审核通过：不退</li><li>审核未通过：出结果后 ${VERIFY.refundHours} 小时内原路退回</li><li>退款进度在结果里可以看到</li></ul></div>
</div></section>
<section class="g-section g-split" id="faq" aria-labelledby="faq-title"><h2 id="faq-title">审核验证常见问题</h2><div class="g-faq">${VERIFY_FAQS.map(([q, a], i) => `<details${i === 0 ? ' open' : ''}><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}</div></section>
</main>
<div class="toast" role="status" aria-live="polite" data-toast></div>`;
  return layout({
    route, store: true, title: VERIFY_TITLE, description: VERIFY_DESCRIPTION, body, buy: { href: '#submit', label: '提交审核' },
    head: `<link rel="stylesheet" href="${href(route, 'assets/gettoken/verify.css')}">\n<script type="module" src="${href(route, 'assets/gettoken/verify.mjs')}"></script>\n`,
    schema: [crumbList(crumbs), {
      '@type': 'WebPage', '@id': `${url(route)}#webpage`, url: url(route), name: '审核验证', description: VERIFY_DESCRIPTION,
      dateModified: VERIFY_UPDATED, inLanguage: 'zh-CN', isPartOf: { '@id': website['@id'] },
      mainEntity: { '@type': 'Service', name: '审核验证', serviceType: '人工审核', provider: { '@id': organization['@id'] }, areaServed: 'CN', description: VERIFY_DESCRIPTION },
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
<form class="a-search" data-search><label class="g-visually-hidden" for="a-q">搜索</label><input id="a-q" name="q" placeholder="订单号 / 代码末 4 位" autocomplete="off"></form></div>
<div class="a-table-wrap"><table class="a-table"><thead><tr><th>订单号</th><th>代码</th><th>状态</th><th>付款</th><th>剩余</th></tr></thead><tbody data-rows></tbody></table></div>
<div class="a-pager" data-pager></div>
</section>
<aside class="v-card a-detail" data-detail aria-live="polite"><p class="v-hint">点选左侧订单查看详情。</p></aside>
</div>
</div>
</main>
<div class="toast" role="status" aria-live="polite" data-toast></div>`;
  return layout({
    route, store: true, robots: 'noindex, nofollow', title: '审核后台 - GetToken', description: '审核验证订单管理，仅限管理员。', body,
    buy: { href: href(route, VERIFY_ROUTE), label: '返回审核页' },
    head: `<link rel="stylesheet" href="${href(route, 'assets/gettoken/verify.css')}">\n<script type="module" src="${href(route, 'assets/gettoken/verify-admin.mjs')}"></script>\n`,
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
  return `${html.slice(0, start + LATEST_START.length)}\n        <ol class="news-grid">\n${items}\n        </ol>\n        ${html.slice(end)}`;
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
  outputs.set('robots.txt', `User-agent: *\nAllow: /\nDisallow: /${VERIFY_ADMIN_ROUTE}\n\nSitemap: ${url('sitemap.xml')}\n`);
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
