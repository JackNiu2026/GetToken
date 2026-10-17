import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { gzipSync } from 'node:zlib';
import { ROOT, ROUTES, PAGES, ARTICLES, REDIRECTS, FEED_ROUTE, generateSite } from '../scripts/build-site.mjs';
import { parseFrontMatter, parseBlocks, splitArticle, inline, loadArticles } from '../scripts/content.mjs';
import { writeFile } from 'node:fs/promises';
import { SITE } from '../content/site.mjs';
import { exportSeoReport } from '../scripts/seo-report.mjs';
import { auditLive, robotsAllows, ASSETS } from '../scripts/check-live-seo.mjs';

async function deployedFixture() {
  const map=new Map();
  const htmlType={'content-type':'text/html; charset=utf-8'};
  for(const route of ROUTES) {
    map.set(`${SITE.origin}/${route}`,{body:await readFile(resolve(ROOT,route,'index.html'),'utf8'),headers:htmlType,status:200});
    if(route)for(const path of [`${route}index.html`,route.slice(0,-1)])map.set(`${SITE.origin}/${path}`,{body:'',headers:{location:`/${route}`},status:301});
  }
  for(const [from,to] of REDIRECTS)for(const path of [from,`${from}index.html`,from.slice(0,-1)])map.set(`${SITE.origin}/${path}`,{body:'',headers:{location:`/${to}`},status:301});
  const types={xml:'application/rss+xml',javascript:'application/javascript'};
  for(const [path,type] of [['robots.txt','text/plain'],['sitemap.xml','application/xml'],...ASSETS.map(([path,type])=>[path,types[type]||type])])map.set(`${SITE.origin}/${path}`,{body:await readFile(join(ROOT,path)),headers:{'content-type':type},status:200});
  map.set(SITE.origin.replace('https:','http:')+'/',{body:'',headers:{location:SITE.origin+'/'},status:301});
  for (const path of ['/verify/?order=GT-VF-1014-AAAAAA', '/verify/admin/']) map.set(SITE.origin+path,{body:'Private shell',status:200,headers:{'x-robots-tag':'noindex, nofollow','cache-control':'no-store'}});
  return {map,fetcher:async address=>{const row=map.get(address)||{body:'Not found',status:404};return new Response(row.body,{status:row.status,headers:row.headers});}};
}

test('Markdown articles parse into sections, answers and sources',()=>{
  const {data,body}=parseFrontMatter('---\ntitle: 标题：带冒号\ntopics: [codex, claude]\nrelated:\n  - a-guide\nfeatured: true\n---\n## 第一节\n\n第一行\n第二行 English\nwords\n\n- 列表一\n- [官方](https://example.com/x)\n\n| 项目 | 说明 |\n| --- | --- |\n| A | B |\n\n> 提示内容\n\n## 常见问题\n\n### 问题一？\n\n答案一。\n\n## 资料来源\n\n- [来源](https://example.com/source)\n','t.md');
  assert.equal(data.title,'标题：带冒号');
  assert.deepEqual(data.topics,['codex','claude']);
  assert.deepEqual(data.related,['a-guide']);
  assert.equal(data.featured,true);
  const {sections,faqs,sources}=splitArticle(parseBlocks(body),'t.md');
  assert.equal(sections.length,1);
  assert.deepEqual(sections[0].blocks.map(b=>b.type),['p','ul','table','note']);
  assert.equal(sections[0].blocks[0].text,'第一行第二行 English words','Chinese lines join directly; Latin words keep a space');
  assert.deepEqual(sections[0].blocks[2].rows,[['A','B']]);
  assert.deepEqual(faqs,[{q:'问题一？',a:['答案一。']}]);
  assert.deepEqual(sources,[['来源','https://example.com/source']]);
  assert.equal(inline('**重点** `code` <b>',()=>''),'<strong>重点</strong> <code>code</code> &lt;b&gt;');
  assert.throws(()=>splitArticle(parseBlocks('## 资料来源\n\n- http://insecure.example\n'),'t.md'),/must be \[label\]/);
  assert.throws(()=>splitArticle(parseBlocks('正文先于标题'),'t.md'),/must start with a ## heading/);
  assert.throws(()=>parseFrontMatter('no front matter','t.md'),/missing front matter/);
});

test('articles default to guides and accept only known types',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'gettoken-types-'));
  const article=type=>`---\ntitle: 标题\ndescription: 描述\nsummary: 摘要\ntopic: claude\n${type?`type: ${type}\n`:''}updated: 2026-10-14\n---\n## 一\n\n正文。\n\n## 二\n\n正文。\n`;
  try {
    await writeFile(join(dir,'a-guide.md'),article());
    await writeFile(join(dir,'a-news.md'),article('news'));
    assert.deepEqual(loadArticles(dir).map(a=>[a.slug,a.type]).sort(),[['a-guide','guide'],['a-news','news']]);
    await writeFile(join(dir,'a-bad.md'),article('rumor'));
    assert.throws(()=>loadArticles(dir),/type must be one of guide, news/);
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('articles expose honest update dates, sources and contextual related links',async()=>{
  const sitemap=await readFile(join(ROOT,'sitemap.xml'),'utf8');
  for(const page of PAGES.filter(p=>p.modified))assert.ok(sitemap.includes(`<loc>${SITE.origin}/${page.route}</loc><lastmod>${page.modified}</lastmod>`),page.route);
  assert.ok(sitemap.includes(`<loc>${SITE.origin}/</loc></url>`),'Original homepage receives no invented modification date');
  for(const guide of ARTICLES) {
    const html=await readFile(resolve(ROOT,'guides',guide.slug,'index.html'),'utf8');
    const graph=JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1])['@graph'];
    const article=graph.find(row=>row['@type']===(guide.type==='news'?'NewsArticle':'Article'));
    assert.equal(article.headline,guide.title);
    assert.equal(article.dateModified,guide.updated);
    assert.deepEqual(article.citation,guide.sources.map(([,address])=>address));
    assert.ok(html.includes(`<time datetime="${guide.updated}">${guide.updated}</time>`));
    assert.equal(article.datePublished,guide.published||undefined,'A publication date appears only when the article records one');
    assert.ok(html.includes('GetToken 编辑部'));
    for(const slug of guide.related)assert.ok(html.includes(`guides/${slug}/`));
    for(const {q,a} of guide.faqs)assert.ok(html.includes(q)&&a.every(text=>html.includes(text)),'Answers visible in HTML');
    for(const section of guide.sections)assert.ok(html.includes(`<h2>${section.title}</h2>`));
  }
  const before=await readFile(join(ROOT,'sitemap.xml'),'utf8');
  await generateSite();
  assert.equal(await readFile(join(ROOT,'sitemap.xml'),'utf8'),before,'Builds must not refresh dates');
});

test('guide pages need only the shared header script; product and verify pages add only their module',async()=>{
  for(const page of PAGES.filter(p=>p.route)) {
    const route=page.route;
    const html=await readFile(resolve(ROOT,route,'index.html'),'utf8');
    const scripts=[...html.matchAll(/<script\b(?![^>]*type="application\/ld\+json")[^>]*>/gi)].map(m=>m[0]);
    // Every generated page runs the shared header (chrome.mjs); product and verify pages add their own module.
    const up='../'.repeat(route.split('/').filter(Boolean).length);
    const modules={product:[`<script type="module" src="${up}assets/gettoken/product.mjs">`],verify:[`<script type="module" src="${up}assets/gettoken/verify.mjs?v=sidebar-20261017">`]};
    assert.deepEqual(scripts,[`<script type="module" src="${up}assets/gettoken/chrome.mjs">`,...(modules[page.kind]||[])],`Scripts on ${route}`);
    assert.ok(Buffer.byteLength(html)<64*1024,route);
    assert.ok(gzipSync(html).length<16*1024,route);
    assert.doesNotMatch(html,/"@type":"(?:Offer|AggregateRating|Review)"/);
    assert.doesNotMatch(html,/home\.css/,'Guide pages load only their own stylesheet');
  }
  assert.ok((await readFile(join(ROOT,'assets/guides/guides.css'))).length<24*1024);
  assert.ok((await readFile(join(ROOT,'assets/gettoken/product.css'))).length<24*1024);
  assert.ok((await readFile(join(ROOT,'assets/gettoken/verify.css'))).length<32*1024);
});

test('keyword exports contain usable URLs and blank measured ranking fields',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'gettoken-seo-export-'));
  try {
    const report=await exportSeoReport(dir);
    assert.equal(report.productionVerified,false);
    assert.equal(report.keywords.length,32);
    assert.equal(new Set(report.keywords.map(row=>row.query)).size,32);
    const csv=(await readFile(join(dir,'ranking-tracker.csv'),'utf8')).trim().split('\n');
    assert.equal(csv.length,65);
    assert.ok(csv.slice(1).every(line=>line.endsWith('"","","","","","","",""')));
    assert.equal((await readFile(join(dir,'submit-urls.txt'),'utf8')).trim().split('\n').length,ROUTES.length);
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('crawl directives respect separate bot groups, wildcards and allow precedence',()=>{
  const body='User-agent: *\nDisallow:\nUser-agent: Googlebot\nDisallow: /guides/\nAllow: /guides/public/\nUser-agent: Baiduspider\nDisallow: /*private$\n';
  assert.equal(robotsAllows(body,'Googlebot','/guides/secret/'),false);
  assert.equal(robotsAllows(body,'Googlebot','/guides/public/intro/'),true);
  assert.equal(robotsAllows(body,'Baiduspider','/guides/intro/'),true);
  assert.equal(robotsAllows(body,'Baiduspider','/guides/private'),false);
  assert.equal(robotsAllows(body,'OtherBot','/guides/secret/'),true);
  assert.equal(robotsAllows('User-agent: *\nDisallow: /guides/\nAllow: /guides/','Googlebot','/guides/intro/'),true);
});

test('public sharing metadata and home schema have reachable honest brand defaults', async () => {
  for (const route of ROUTES) {
    const html = await readFile(resolve(ROOT, route, 'index.html'), 'utf8');
    const image = html.match(/<meta property="og:image" content="([^"]+)">/)?.[1];
    assert.ok(image, route);
    assert.equal(new URL(image).origin, SITE.origin);
    await readFile(resolve(ROOT, '.' + new URL(image).pathname));
    assert.match(html, /<meta property="og:locale" content="zh_CN">/);
    assert.ok(html.includes(`<meta property="og:url" content="${SITE.origin}/${route}">`));
  }
  const home = await readFile(resolve(ROOT, 'index.html'), 'utf8');
  const graph = JSON.parse(home.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1])['@graph'];
  assert.ok(graph.some(node => node['@type'] === 'WebSite'));
  assert.ok(graph.some(node => node['@type'] === 'Organization'));
});

test('live audit accepts valid HTTP behavior and reports observed failures',async()=>{
  const fixture=await deployedFixture();
  const success=await auditLive({fetcher:fixture.fetcher});
  assert.deepEqual(success.issues,[]);
  assert.equal(success.productionVerified,true,'A fixture simulates verified HTTP only; it says nothing about actual deployment');
  fixture.map.set(`${SITE.origin}/robots.txt`,{body:`User-agent: Baiduspider\nDisallow: /guides/\nSitemap: ${SITE.origin}/sitemap.xml`,status:200});
  fixture.map.set(`${SITE.origin}/__gettoken_seo_missing_page__/`,{body:'Homepage',status:200});
  fixture.map.set(`${SITE.origin}/guides/index.html`,{body:'Duplicate',status:200});
  fixture.map.set(`${SITE.origin}/navigation/`,{body:'Old hub',status:200});
  const guide=`${SITE.origin}/guides/${ARTICLES[0].slug}/`;
  const row=fixture.map.get(guide);
  fixture.map.set(guide,{...row,headers:{...row.headers,'x-robots-tag':'noindex'}});
  const failure=await auditLive({fetcher:fixture.fetcher});
  fixture.map.set(guide,{...row,body:row.body+'<!--unexpected modification-->'});
  const changed=await auditLive({fetcher:fixture.fetcher});
  assert.ok(changed.issues.some(issue=>issue.type==='content'));
  for(const type of ['crawl','soft404','alias','indexing','redirect'])assert.ok(failure.issues.some(issue=>issue.type===type),type);
  assert.equal(failure.productionVerified,false);
});

test('public revision checks detect deployment to the wrong served directory',async()=>{
  const revision='a'.repeat(40),fixture=await deployedFixture();
  fixture.map.set(`${SITE.origin}/deployment.json`,{body:JSON.stringify({commit:revision}),status:200});
  assert.deepEqual((await auditLive({fetcher:fixture.fetcher,expectedRevision:revision})).issues,[]);
  const wrong=await auditLive({fetcher:fixture.fetcher,expectedRevision:'b'.repeat(40)});
  assert.ok(wrong.issues.some(issue=>issue.type==='revision'));
  await assert.rejects(()=>auditLive({expectedRevision:'main'}),/full commit SHA/);
});

test('transport failures remain incomplete rather than alleging a site defect',async()=>{
  const result=await auditLive({fetcher:async()=>{throw new Error('CONNECT proxy denied');}});
  assert.equal(result.status,'incomplete');
  assert.equal(result.productionVerified,false);
  assert.equal(result.issues[0].type,'transport');
  await assert.rejects(()=>auditLive({baseURL:'http://example.com'}),/require HTTPS/);
});
