#!/usr/bin/env node
// Independent contact pages. Does not regenerate existing production pages or navigation.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const people = JSON.parse(await readFile(resolve(root, 'content/contact-pages.json'), 'utf8'));
const esc = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const links = [['首页', '/'], ['Claude订阅', '/claude/'], ['Codex订阅', '/codex/'], ['Gemini订阅', '/gemini/'], ['技术咨询', '/support/'], ['KYC审核', '/verify/'], ['订阅转换', '/clash/'], ['技术交付', '/delivery/']];
for (const p of people) {
  if (!/^[a-z]+$/.test(p.slug) || p.route !== `/support/${p.slug}/` || p.qr !== `/assets/contacts/${p.slug}-wechat.png`) throw Error('Unexpected contact route');
  const name = esc(p.name), qr = esc(p.qr);
  const html = `<!doctype html>
<html lang="zh-CN"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${name} · 企业微信咨询 | GetToken</title>
<meta name="description" content="扫码添加${name}的企业微信，沟通你的需求。支持微信扫一扫、手机长按识别及保存二维码。">
<meta name="referrer" content="no-referrer"><link rel="canonical" href="https://gettoken.cc${p.route}">
<meta property="og:type" content="website"><meta property="og:title" content="${name} · 企业微信咨询 | GetToken"><meta property="og:description" content="扫码添加企业微信，沟通你的需求。"><meta property="og:url" content="https://gettoken.cc${p.route}"><meta property="og:image" content="https://gettoken.cc${qr}"><meta property="og:image:alt" content="${name}的企业微信二维码">
<link rel="icon" href="/assets/gettoken/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/assets/contacts/contact.css?v=20261124">
</head><body>
<a class="skip" href="#main">跳到正文</a>
<header class="site-header"><div class="shell header-inner"><a class="brand" href="/" aria-label="GetToken 首页"><img src="/assets/gettoken/logo.png" width="28" height="28" alt=""><span>GetToken</span></a><nav aria-label="主导航">${links.map(([label, path]) => `<a href="${path}"${path === '/support/' ? ' class="active"' : ''}>${label}</a>`).join('')}</nav></div></header>
<main id="main" class="shell"><nav class="crumbs" aria-label="面包屑"><ol><li><a href="/">首页</a></li><li><a href="/support/">技术咨询</a></li><li aria-current="page">${name}</li></ol></nav>
<section class="contact-hero" aria-labelledby="page-title"><div class="intro"><h1 id="page-title">扫码添加<br>${name}</h1><p class="lead">添加企业微信，<br class="desktop-break">沟通你的需求。</p><a class="button primary" href="#wechat">企业微信咨询</a><a class="back-link" href="/support/">返回技术咨询</a></div>
<section class="qr-panel" id="wechat" aria-labelledby="qr-title"><h2 id="qr-title">${name}的企业微信</h2><p>微信扫一扫，手机端可长按识别。</p><a class="qr-image-link" href="${qr}" target="_blank" rel="noopener noreferrer" aria-label="打开${name}的企业微信二维码原图"><img class="qr-image" src="${qr}" width="${p.width}" height="${p.height}" alt="扫描二维码，添加${name}的企业微信" decoding="sync" fetchpriority="high"></a><div class="qr-actions"><a class="button primary" href="${qr}" download="${name}-企业微信二维码.png">保存二维码</a><a class="text-link" href="${qr}" target="_blank" rel="noopener noreferrer">打开二维码原图</a></div></section></section>
<section class="how" aria-labelledby="how-title"><h2 id="how-title">加上微信，继续沟通</h2><ol><li><strong>扫描或识别二维码</strong><p>电脑端用微信扫一扫；手机端可长按二维码识别，或保存后从微信相册选择。</p></li><li><strong>确认联系人</strong><p>在企业微信名片中确认姓名为「${name}」，再发送添加申请。</p></li><li><strong>说明你的需求</strong><p>添加后直接说明想咨询的问题，必要时附上相关截图，方便沟通。</p></li></ol></section>
</main><footer class="footer"><div class="shell"><a class="brand" href="/"><img src="/assets/gettoken/logo.png" width="24" height="24" alt=""><span>GetToken</span></a><p>扫码添加企业微信，与${name}联系。</p><div class="footer-bottom"><span>© 2026 GetToken</span><a href="/support/">技术咨询</a><a href="/">返回首页</a></div></div></footer>
</body></html>
`;
  const target = resolve(root, `support/${p.slug}/index.html`);
  if (process.argv.includes('--check')) {
    if (await readFile(target, 'utf8') !== html) throw Error(`Regenerate ${p.route}`);
  } else { await mkdir(resolve(root, `support/${p.slug}`), { recursive: true }); await writeFile(target, html); }
}
console.log(`${process.argv.includes('--check') ? 'Verified' : 'Generated'} ${people.length} independent contact pages.`);
