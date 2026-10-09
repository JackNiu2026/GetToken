import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { gzipSync } from 'node:zlib';
import { ROOT, ROUTES, generateSite } from '../scripts/build-site.mjs';
import { GUIDES } from '../content/guides.mjs';
import { EDITORIAL } from '../content/editorial.mjs';
import { SITE } from '../content/site.mjs';
import { exportSeoReport } from '../scripts/seo-report.mjs';
import { auditLive, robotsAllows } from '../scripts/check-live-seo.mjs';

async function deployedFixture() {
  const map=new Map();
  const htmlType={'content-type':'text/html; charset=utf-8'};
  for(const route of ROUTES) {
    map.set(`${SITE.origin}/${route}`,{body:await readFile(resolve(ROOT,route,'index.html'),'utf8'),headers:htmlType,status:200});
    if(route)for(const path of [`${route}index.html`,route.slice(0,-1)])map.set(`${SITE.origin}/${path}`,{body:'',headers:{location:`/${route}`},status:301});
  }
  for(const [path,type] of [['robots.txt','text/plain'],['sitemap.xml','application/xml'],['assets/gettoken/home.css','text/css'],['assets/gettoken/pages.css','text/css'],['assets/gettoken/logo.png','image/png']])map.set(`${SITE.origin}/${path}`,{body:await readFile(join(ROOT,path)),headers:{'content-type':type},status:200});
  map.set(SITE.origin.replace('https:','http:')+'/',{body:'',headers:{location:SITE.origin+'/'},status:301});
  return {map,fetcher:async address=>{const row=map.get(address)||{body:'Not found',status:404};return new Response(row.body,{status:row.status,headers:row.headers});}};
}

test('articles expose honest update dates, sources and contextual related links',async()=>{
  const sitemap=await readFile(join(ROOT,'sitemap.xml'),'utf8');
  assert.ok(sitemap.includes(`<loc>${SITE.origin}/navigation/</loc><lastmod>${EDITORIAL.navigationModified}</lastmod>`));
  assert.ok(sitemap.includes(`<loc>${SITE.origin}/</loc></url>`),'Original homepage receives no invented modification date');
  for(const guide of GUIDES) {
    const html=await readFile(resolve(ROOT,'guides',guide.slug,'index.html'),'utf8');
    const graph=JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1])['@graph'];
    const article=graph.find(row=>row['@type']==='Article');
    assert.equal(article.headline,guide.title);
    assert.equal(article.dateModified,guide.modified);
    assert.deepEqual(article.citation,guide.sources.map(([,address])=>address));
    assert.ok(html.includes(`<time datetime="${guide.modified}">${guide.modified}</time>`));
    assert.equal(article.datePublished,undefined,'Draft work must not fabricate a production publication date');
    assert.ok(html.includes('GetToken 内容整理'));
    assert.ok(guide.related.length>=2);
    for(const slug of guide.related)assert.ok(html.includes(`guides/${slug}/`));
    for(const [q,a] of guide.faqs)assert.ok(html.includes(q)&&html.includes(a),'Answers visible in HTML');
  }
  const before=await readFile(join(ROOT,'sitemap.xml'),'utf8');
  await generateSite();
  assert.equal(await readFile(join(ROOT,'sitemap.xml'),'utf8'),before,'Builds must not refresh dates');
});

test('new content stays compact and readable without runtime JavaScript',async()=>{
  for(const route of ROUTES.filter(Boolean)) {
    const html=await readFile(resolve(ROOT,route,'index.html'),'utf8');
    assert.doesNotMatch(html,/<script\b[^>]*\bsrc=/i);
    assert.ok(Buffer.byteLength(html)<64*1024,route);
    assert.ok(gzipSync(html).length<16*1024,route);
    assert.doesNotMatch(html,/"@type":"(?:Offer|AggregateRating|Review)"/);
  }
  assert.ok((await readFile(join(ROOT,'assets/gettoken/pages.css'))).length<12*1024);
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

test('live audit accepts valid HTTP behavior and reports observed failures',async()=>{
  const fixture=await deployedFixture();
  const success=await auditLive({fetcher:fixture.fetcher});
  assert.deepEqual(success.issues,[]);
  assert.equal(success.productionVerified,true,'A fixture simulates verified HTTP only; it says nothing about actual deployment');
  fixture.map.set(`${SITE.origin}/robots.txt`,{body:`User-agent: Baiduspider\nDisallow: /guides/\nSitemap: ${SITE.origin}/sitemap.xml`,status:200});
  fixture.map.set(`${SITE.origin}/__gettoken_seo_missing_page__/`,{body:'Homepage',status:200});
  fixture.map.set(`${SITE.origin}/navigation/index.html`,{body:'Duplicate',status:200});
  const guide=`${SITE.origin}/guides/${GUIDES[0].slug}/`;
  const row=fixture.map.get(guide);
  fixture.map.set(guide,{...row,headers:{...row.headers,'x-robots-tag':'noindex'}});
  const failure=await auditLive({fetcher:fixture.fetcher});
  for(const type of ['crawl','soft404','alias','indexing'])assert.ok(failure.issues.some(issue=>issue.type===type),type);
  assert.equal(failure.productionVerified,false);
});

test('transport failures remain incomplete rather than alleging a site defect',async()=>{
  const result=await auditLive({fetcher:async()=>{throw new Error('CONNECT proxy denied');}});
  assert.equal(result.status,'incomplete');
  assert.equal(result.productionVerified,false);
  assert.equal(result.issues[0].type,'transport');
  await assert.rejects(()=>auditLive({baseURL:'http://example.com'}),/require HTTPS/);
});
