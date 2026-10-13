#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITE } from '../content/site.mjs';
import { SERVICES } from '../content/services.mjs';
import { GUIDES } from '../content/guides.mjs';
import { EDITORIAL, NAVIGATION } from '../content/editorial.mjs';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const origin = new URL(SITE.origin);
if (origin.protocol !== 'https:' || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') {
  throw new Error('SITE.origin must be an HTTPS origin without credentials, query or path.');
}
const ORIGIN = origin.origin;
const dateIsValid = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().startsWith(value);
function validateContent() {
  const slugs = new Set(GUIDES.map(g => g.slug));
  if (slugs.size !== GUIDES.length) throw new Error('Guide slugs must be unique.');
  const names = new Set(SERVICES.map(s => s.slug));
  if (names.size !== SERVICES.length) throw new Error('Topic slugs must be unique.');
  if (!dateIsValid(EDITORIAL.navigationModified)) throw new Error('Navigation modification date is invalid.');
  for (const guide of GUIDES) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(guide.slug) || !names.has(guide.service)) throw new Error(`Invalid guide route or topic: ${guide.slug}`);
    if (!guide.title || !guide.description || !guide.summary || !dateIsValid(guide.modified)) throw new Error(`Missing guide metadata: ${guide.slug}`);
    if (!guide.related?.length || new Set(guide.related).size !== guide.related.length || guide.related.some(s => !slugs.has(s) || s === guide.slug)) throw new Error(`Invalid related guides: ${guide.slug}`);
    if (!guide.faqs?.length || guide.faqs.some(row => row.length !== 2 || row.some(value => !value))) throw new Error(`Invalid guide answers: ${guide.slug}`);
    if (guide.services?.some(s => !names.has(s))) throw new Error(`Invalid guide topics: ${guide.slug}`);
    for (const [, address] of guide.sources) {
      const parsed = new URL(address);
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error(`Unsafe source on ${guide.slug}`);
    }
  }
  for (const service of SERVICES) if (service.guideSlugs.some(s => !slugs.has(s))) throw new Error(`Missing topic guide: ${service.slug}`);
  if (NAVIGATION.startHere.some(s => !slugs.has(s))) throw new Error('Unknown starting guide.');
  const grouped = NAVIGATION.questions.flatMap(q => q.guides);
  if (grouped.length !== GUIDES.length || grouped.some(s => !slugs.has(s)) || new Set(grouped).size !== GUIDES.length) throw new Error('Every guide must appear in exactly one navigation question.');
}
validateContent();
export const ROUTES = ['', 'navigation/', ...GUIDES.map(g => `guides/${g.slug}/`)];
const esc = value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const json = value => JSON.stringify(value).replace(/</g, '\\u003c');
const url = route => `${ORIGIN}/${route}`;
const href = (route, to = '') => `${'../'.repeat(route.split('/').filter(Boolean).length)}${to}`;
const external = ([label, address]) => `<a href="${esc(address)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`;
const organization = { '@type': 'Organization', '@id': `${ORIGIN}/#organization`, name: 'GetToken', url: url(''), logo: url('assets/gettoken/logo.png') };
const website = { '@type': 'WebSite', '@id': `${ORIGIN}/#website`, name: 'GetToken', url: url(''), inLanguage: 'zh-CN' };

function crumbs(route, label) {
  const items = [{ name: '首页', item: url('') }];
  if (route !== 'navigation/') items.push({ name: '订阅导航', item: url('navigation/') });
  items.push({ name: label, item: url(route) });
  return { '@type': 'BreadcrumbList', itemListElement: items.map((item, i) => ({ '@type': 'ListItem', position: i + 1, ...item })) };
}
function page(route, title, description, content, schema = [], article = false, modified) {
  const graph = [organization, website, ...schema];
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#0b0b10">
  <title>${esc(title)}</title><meta name="description" content="${esc(description)}">
  <link rel="canonical" href="${url(route)}">
  <meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}">
  <meta property="og:url" content="${url(route)}"><meta property="og:type" content="${article ? 'article' : 'website'}"><meta property="og:locale" content="zh_CN"><meta property="og:site_name" content="GetToken">
  <meta name="twitter:card" content="summary"><meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(description)}">
${article ? `  <meta property="article:modified_time" content="${esc(modified)}">` : ''}
  <script type="application/ld+json">${json({ '@context': 'https://schema.org', '@graph': graph })}</script>
  <link rel="icon" href="${href(route, 'assets/gettoken/favicon.svg')}" type="image/svg+xml">
  <link rel="stylesheet" href="${href(route, 'assets/gettoken/home.css')}"><link rel="stylesheet" href="${href(route, 'assets/gettoken/pages.css')}">${route === 'navigation/' ? `<link rel="stylesheet" href="${href(route, 'assets/gettoken/navigation.css')}">` : ''}
</head><body class="seo-page"><a class="seo-skip" href="#main">跳到正文</a>
<header class="seo-header"><div class="shell seo-header__inner"><a class="brand" href="${href(route)}" aria-label="GetToken 首页"><img class="brand-logo" src="${href(route, 'assets/gettoken/logo.png')}" width="28" height="28" alt=""><span class="brand-word">GetToken</span></a><nav aria-label="主导航"><a href="${href(route, 'navigation/')}"${route === 'navigation/' ? ' aria-current="page"' : ''}>订阅导航</a><a href="${href(route, 'navigation/')}#guides">选购指南</a></nav><a class="button button--ghost" href="${href(route)}">返回首页</a></div></header>
${content}
<footer class="seo-footer"><div class="shell"><div><a class="brand" href="${href(route)}"><span class="brand-word">GetToken</span></a><nav aria-label="页脚导航"><a href="${href(route, 'navigation/')}">AI 订阅导航</a><a href="${href(route)}#pricing">首页套餐</a><a href="${href(route)}#faq">购买常见问题</a></nav></div><p>GetToken 是独立第三方服务品牌，与 OpenAI、Google、xAI、Anthropic 无隶属关系。具体可售方案、账号资格、价格与交付条件需在购买前确认；产品权益以当前官方说明与实际账号状态为准。</p></div></footer>
</body></html>\n`;
}
function readingLinks(route, guides) {
  return `<div class="reading-links">${guides.map(g => `<a href="${href(route, `guides/${g.slug}/`)}"><strong>${esc(g.title)}</strong><p>${esc(g.summary)}</p></a>`).join('')}</div>`;
}
// Decorative product marks for the navigation hub; names stay in the headings.
const MARKS = { codex: '&gt;_', gemini: '◆', grok: 'G', claude: '✦', 'claude-code': '&lt;/&gt;' };
const guideBySlug = slug => GUIDES.find(g => g.slug === slug);
const topicLabel = g => g.services ? '通用' : SERVICES.find(s => s.slug === g.service).name;
function navigationPage() {
  const route = 'navigation/';
  const title = 'Codex、Gemini、Grok、Claude 与 Claude Code 订阅代充导航 - GetToken';
  const description = 'AI 订阅选购导航：了解 Codex、Gemini、Grok、Claude、Claude Code 的订阅、充值、代充、独立账号与月卡，阅读套餐、额度及续费指南。';
  const guideHref = g => href(route, `guides/${g.slug}/`);
  const updated = `<time datetime="${EDITORIAL.navigationModified}">${EDITORIAL.navigationModified}</time>`;
  const ordered = NAVIGATION.questions.flatMap(q => q.guides.map(guideBySlug));
  const body = `<div class="hub-top"><nav class="shell seo-breadcrumbs" aria-label="面包屑"><a href="${href(route)}">首页</a><span>/</span><span aria-current="page">AI 订阅导航</span></nav>
<header class="shell hub-hero"><div><p class="hub-eyebrow">GetToken 选购指南</p><h1>AI 订阅与代充导航</h1><p class="hub-lead">从 Codex、Gemini、Grok 到 Claude、Claude Code，按产品了解订阅、账号与月卡的区别，再选择适合自己的购买方式。</p><p class="editorial-meta">${GUIDES.length} 篇专题文章 · ${SERVICES.length} 个产品 · <a href="#editorial">GetToken 内容整理</a> · 更新：${updated}</p></div>
<aside class="hub-start" aria-labelledby="start-title"><h2 id="start-title">第一次来，先读这三篇</h2><ol>${NAVIGATION.startHere.map(guideBySlug).map(g => `<li><a href="${guideHref(g)}"><strong>${esc(g.title)}</strong><span>${esc(topicLabel(g))}</span></a></li>`).join('')}</ol></aside></header></div>
<nav class="hub-bar" aria-label="按产品或问题查找"><div class="shell">${SERVICES.map(s => `<a href="#${s.slug}">${esc(s.name)} <small>${s.guideSlugs.length}</small></a>`).join('')}<span aria-hidden="true"></span><a href="#guides">按问题查找</a><a href="#faq">常见问题</a></div></nav>
<main id="main" class="shell">
<section class="hub-delivery" aria-labelledby="delivery-title"><h2 id="delivery-title">两种主要交付方式</h2><div><h3>给自己的账号代充</h3><p>已有账号，希望保留原来的使用记录？先确认账号资格、适用套餐、原订阅状态，以及开通或续费的方式。</p></div><div><h3>选择独立账号</h3><p>需要一个单独使用的账号？确认是否包含会员、实际套餐、有效期、管理权限，以及交付后的售后条件。</p></div><a href="${href(route, 'guides/account-topup-or-independent/')}">详细对比：代充与独立账号有什么区别 →</a></section>
${SERVICES.map(s => `<section class="hub-topic" id="${s.slug}" data-topic="${s.slug}" aria-labelledby="${s.slug}-title"><div class="hub-topic__head"><span class="hub-mark" aria-hidden="true">${MARKS[s.slug]}</span><div><h2 id="${s.slug}-title">${esc(s.name)} 订阅、代充与月卡</h2><p>${esc(s.intro)}</p></div><a class="official-link" href="${esc(s.source[1])}" target="_blank" rel="noopener noreferrer">核对官方说明 ↗</a></div><dl class="hub-facts">${s.distinctions.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl><h3 class="hub-sub">${esc(s.name)} 选购指南</h3><ul class="hub-cards">${s.guideSlugs.map(guideBySlug).map(g => `<li><a href="${guideHref(g)}"><strong>${esc(g.title)}</strong><p>${esc(g.summary)}</p><span>更新 <time datetime="${g.modified}">${g.modified}</time> · 阅读全文 →</span></a></li>`).join('')}</ul></section>`).join('')}
<section class="hub-questions" id="guides" aria-labelledby="guides-title"><div class="hub-section-head"><h2 id="guides-title">按问题查找全部指南</h2><span>${GUIDES.length} 篇专题文章</span></div><div class="hub-questions__grid">${NAVIGATION.questions.map(q => `<section aria-labelledby="q-${q.slug}"><h3 id="q-${q.slug}">${esc(q.name)}</h3><ul>${q.guides.map(guideBySlug).map(g => `<li><a href="${guideHref(g)}">${esc(g.title)}<small>${esc(topicLabel(g))}</small></a></li>`).join('')}</ul></section>`).join('')}</div></section>
<section class="hub-split" id="faq" aria-labelledby="questions-title"><h2 id="questions-title">订阅购买前的常见问题</h2><div class="seo-faq"><details><summary>订阅、充值和代充有什么区别？</summary><p>订阅是购买会员权益；充值可能指订阅开通、额外用量或 API 余额；代充是协助给已有账号开通或续费的交付方式。先说明产品、使用入口和需求，避免买错服务。</p></details><details><summary>月卡是否代表不限量使用？</summary><p>月卡描述期限，不代表无限用量。需要同时确认套餐名称、起算时间、额度限制、重置规则、超额处理与续费方式。</p></details><details><summary>Claude 和 Claude Code 应该分别购买吗？</summary><p>Claude Code 是编码工具。使用适用的 Claude 订阅与 API 接入是不同计费路径；先核实账号与登录方式，不重复购买相同权益。</p></details><details><summary>在哪里查看套餐价格与购买入口？</summary><p>返回 <a href="${href(route)}#pricing">GetToken 首页套餐区</a> 查看现有展示与购买入口。Gemini、Grok 等导航主题不表示当前已有可售库存；实际套餐、价格、交付和售后需另行确认。</p></details></div></section>
<section class="hub-split" id="editorial" aria-labelledby="editorial-title"><h2 id="editorial-title">内容来源与更新原则</h2><div><p>这些指南由 GetToken 根据官方资料和已确认的交付方式整理，帮助核对账号、订阅与购买条件。涉及产品权益、资格和计费的信息会列出来源；具体规则以当前官方说明和目标账号状态为准。</p><p>文章日期仅在正文或重要信息有实质变化时更新。具体可售套餐、价格、库存、交付时效和售后，需要通过原首页实际公布的渠道确认。</p><p class="editorial-meta">GetToken 内容整理 · 导航更新：${updated}</p></div></section>
<div class="hub-close"><div><h2>看完指南，确认适合你的方案</h2><p>了解方案后，查看首页套餐与购买说明。</p></div><a class="button button--light" href="${href(route)}#pricing">查看首页套餐</a></div></main>`;
  return page(route, title, description, body, [crumbs(route, 'AI 订阅导航'), {
    '@type': 'CollectionPage', '@id': `${url(route)}#webpage`, name: title, url: url(route), description, dateModified: EDITORIAL.navigationModified,
    inLanguage: 'zh-CN', isPartOf: { '@id': `${ORIGIN}/#website` }, about: SERVICES.map(s => ({ '@type': 'Thing', name: s.name })), mainEntity: { '@id': `${url(route)}#guide-list` },
  }, {
    '@type': 'ItemList', '@id': `${url(route)}#guide-list`, name: 'AI 订阅选购指南', numberOfItems: ordered.length,
    itemListElement: ordered.map((g, i) => ({ '@type': 'ListItem', position: i + 1, name: g.title, url: url(`guides/${g.slug}/`) })),
  }]);
}
function sections(items) {
  return items.map((s, i) => `<section id="section-${i + 1}"><h2>${esc(s.title)}</h2>${s.table ? `<div class="compare-wrap"><table><thead><tr>${s.table.headers.map(h => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${s.table.rows.map(row => `<tr>${row.map(cell => `<td>${esc(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : ''}${(s.paragraphs || []).map(p => `<p>${esc(p)}</p>`).join('')}${s.list ? `<ul>${s.list.map(l => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}</section>`).join('');
}
function guidePage(g) {
  const route = `guides/${g.slug}/`;
  const service = SERVICES.find(s => s.slug === g.service);
  const topics = (g.services || [g.service]).map(slug => SERVICES.find(s => s.slug === slug));
  const related = g.related.map(slug => GUIDES.find(item => item.slug === slug));
  const body = `<nav class="shell seo-breadcrumbs" aria-label="面包屑"><a href="${href(route)}">首页</a><span>/</span><a href="${href(route, 'navigation/')}">订阅导航</a><span>/</span><span aria-current="page">${esc(g.title)}</span></nav><main class="shell" id="main"><header class="reading-header"><h1>${esc(g.title)}</h1><p>${esc(g.summary)}</p><p class="editorial-meta"><a href="${href(route, 'navigation/')}#editorial">GetToken 内容整理</a> · 更新：<time datetime="${g.modified}">${g.modified}</time></p></header><div class="article-layout"><article class="prose">${sections(g.sections)}<section id="questions"><h2>本篇常见问题</h2><div class="seo-faq">${g.faqs.map(([q,a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}</div></section><section id="sources"><h2>核对来源与服务边界</h2><p>本文由 GetToken 整理，帮助理解购买条件，不代表相关产品的官方平台或授权说明。功能、资格与价格可能变化，购买前核对当前官方信息和实际账号状态。</p>${g.sources.length ? `<ul>${g.sources.map(source => `<li>${external(source)}</li>`).join('')}</ul>` : '<p>交付方式与期限应以实际确认的服务清单为准。</p>'}<p>回到${topics.map(s => ` <a href="${href(route, 'navigation/')}#${s.slug}">${esc(s.name)} 导航</a>`).join('、')}，或查看 <a href="${href(route)}#pricing">首页套餐</a>。</p></section></article><aside class="article-aside"><h2>本篇内容</h2><nav aria-label="文章目录">${g.sections.map((item, i) => `<a href="#section-${i + 1}">${esc(item.title)}</a>`).join('')}<a href="#questions">常见问题</a><a href="#sources">资料来源</a></nav><a class="button button--ghost" href="${href(route, 'navigation/')}#${g.services ? 'guides' : service.slug}">返回${g.services ? '选购' : ` ${esc(service.name)}`}导航</a></aside></div><section class="article-related" aria-labelledby="related-title"><h2 id="related-title">继续解决相关问题</h2>${readingLinks(route, related)}</section></main>`;
  return page(route, `${g.title} - GetToken`, g.description, body, [crumbs(route, g.title), {
    '@type': 'WebPage', '@id': `${url(route)}#webpage`, url: url(route), name: g.title, inLanguage: 'zh-CN',
    isPartOf: { '@id': `${ORIGIN}/#website` }, mainEntity: { '@id': `${url(route)}#article` },
  }, {
    '@type': 'Article', '@id': `${url(route)}#article`, headline: g.title, description: g.description,
    url: url(route), mainEntityOfPage: { '@id': `${url(route)}#webpage` }, dateModified: g.modified,
    inLanguage: 'zh-CN', isAccessibleForFree: true, articleSection: 'AI 订阅与账号选购指南',
    author: { '@id': `${ORIGIN}/#organization` }, publisher: { '@id': `${ORIGIN}/#organization` },
    about: topics.map(s => ({ '@type': 'Thing', name: s.name })), citation: g.sources.map(([,address]) => address),
  }], true, g.modified);
}
export async function generateSite({ check = false } = {}) {
  const outputs = new Map([['navigation/index.html', navigationPage()]]);
  for (const guide of GUIDES) outputs.set(`guides/${guide.slug}/index.html`, guidePage(guide));
  outputs.set('robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${url('sitemap.xml')}\n`);
  outputs.set('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${ROUTES.map(route => `  <url><loc>${esc(url(route))}</loc>${route ? `<lastmod>${route === 'navigation/' ? EDITORIAL.navigationModified : GUIDES.find(g => route === `guides/${g.slug}/`).modified}</lastmod>` : ''}</url>`).join('\n')}\n</urlset>\n`);
  const stale = [];
  for (const [name, content] of outputs) {
    let current = null;
    try { current = await readFile(resolve(ROOT, name), 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (current === content) continue;
    if (check) { stale.push(name); continue; }
    await mkdir(dirname(resolve(ROOT, name)), { recursive: true });
    await writeFile(resolve(ROOT, name), content);
  }
  if (stale.length) throw new Error(`Generated pages are missing or stale: ${stale.join(', ')}. Run node scripts/build-site.mjs.`);
  return [...outputs.keys()];
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = await generateSite({ check: process.argv.includes('--check') });
  console.log(`${process.argv.includes('--check') ? 'Verified' : 'Generated'} ${files.length} static files; ${ROUTES.length} indexable routes. Homepage is not generated or modified.`);
}
