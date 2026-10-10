#!/usr/bin/env node
import { readFile, mkdir, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { ROOT, ROUTES } from './build-site.mjs';
import { SITE } from '../content/site.mjs';
import { GUIDES } from '../content/guides.mjs';
import { EDITORIAL } from '../content/editorial.mjs';

const decode = text => text.replace(/&(amp|lt|gt|quot|#39);/g, (_, key) => ({amp:'&',lt:'<',gt:'>',quot:'"','#39':"'"}[key]));
const attr = (tag, name) => decode(tag.match(new RegExp(`(?:\\s|^)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,'i'))?.slice(1).find(value=>value!==undefined) || '');
const tags = (html, name) => [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`,'gi'))].map(m=>m[0]);
const meta = (html, name, field='name') => tags(html,'meta').filter(tag=>attr(tag,field).toLowerCase()===name.toLowerCase()).map(tag=>attr(tag,'content'));
const title = html => decode(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1].trim() || '');
const invalidIndexing = value => /\b(noindex|none)\b/i.test(value);
const run = promisify(execFile);

// curl preserves the environment's proxy and CA trust without npm dependencies.
export async function curlRequest(address, {headers:requestHeaders={}}={}) {
  const directory=await mkdtemp(join(tmpdir(),'gettoken-seo-request-'));
  try {
    const headerPath=join(directory,'headers'),bodyPath=join(directory,'body');
    const headersArguments=Object.entries(requestHeaders).flatMap(([key,value])=>['--header',`${key}: ${value}`]);
    const {stdout}=await run('curl',['--silent','--show-error','--max-time','12','--max-redirs','0','--user-agent','GetToken-SEO-Check/1.0','--dump-header',headerPath,'--output',bodyPath,'--write-out','%{http_code}',...headersArguments,address],{timeout:15000,maxBuffer:1024*1024});
    const raw=await readFile(headerPath,'utf8');
    const last=raw.trim().split(/\r?\n\r?\n/).filter(block=>/^HTTP\//.test(block)).at(-1)||'';
    const headers=new Headers();
    for(const line of last.split(/\r?\n/).slice(1)) {const i=line.indexOf(':');if(i>0)headers.append(line.slice(0,i).trim(),line.slice(i+1).trim());}
    const body=await readFile(bodyPath,'utf8');
    return {status:Number(stdout.trim()),headers,text:async()=>body};
  } finally {await rm(directory,{recursive:true,force:true});}
}

// Implements crawl-path matching for the directives this site depends on.
export function robotsAllows(body, userAgent, path) {
  const groups=[];
  let group={agents:[],rules:[],rulesStarted:false};
  for (const raw of body.split(/\r?\n/)) {
    const line=raw.split('#',1)[0].trim();
    const separator=line.indexOf(':');
    if (separator<0) continue;
    const key=line.slice(0,separator).trim().toLowerCase(), value=line.slice(separator+1).trim();
    if (key==='user-agent') {
      if (group.rulesStarted) { groups.push(group); group={agents:[],rules:[],rulesStarted:false}; }
      group.agents.push(value.toLowerCase());
    } else if ((key==='allow'||key==='disallow') && group.agents.length) {
      group.rulesStarted=true;
      if(value)group.rules.push({allow:key==='allow',pattern:value});
    }
  }
  if (group.agents.length) groups.push(group);
  const agent=userAgent.toLowerCase();
  const scores=groups.map(g=>Math.max(-1,...g.agents.map(a=>a==='*'?0:agent.includes(a)?a.length:-1)));
  const best=Math.max(-1,...scores);
  let result={allow:true,specificity:-1};
  for (let i=0;i<groups.length;i++) if (scores[i]===best && best>=0) for (const rule of groups[i].rules) {
    const end=rule.pattern.endsWith('$');
    const pattern=end?rule.pattern.slice(0,-1):rule.pattern;
    const escaped=pattern.split('*').map(part=>part.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('.*');
    if (!new RegExp(`^${escaped}${end?'$':''}`).test(path)) continue;
    const specificity=pattern.replaceAll('*','').length;
    if (specificity>result.specificity || (specificity===result.specificity && rule.allow)) result={allow:rule.allow,specificity};
  }
  return result.allow;
}
async function parallelMap(items, fn, limit=4) {
  const output=new Array(items.length);
  let cursor=0;
  await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{
    while(cursor<items.length) { const index=cursor++; output[index]=await fn(items[index],index); }
  }));
  return output;
}
export async function auditLive({baseURL=SITE.origin,fetcher=curlRequest,preview=false,checkAliases=true,expectedRevision}={}) {
  if(expectedRevision && !/^[0-9a-f]{40}$/.test(expectedRevision)) throw new Error('Expected revision must be a full commit SHA.');
  const base=new URL(baseURL);
  if (base.username||base.password||base.search||base.hash||base.pathname!=='/') throw new Error('Use a plain origin without credentials, path or query.');
  if (base.protocol!=='https:' && !(preview && base.protocol==='http:' && ['localhost','127.0.0.1','[::1]'].includes(base.hostname))) throw new Error('Production checks require HTTPS. --preview only permits a local HTTP server.');
  const issues=[];
  let checks=0;
  const requireCheck=(condition,url,type,message)=>{checks++;if(!condition)issues.push({url,type,message});};
  const cached=new Map();
  async function get(path) {
    const address=new URL(path,base).href;
    if (!cached.has(address)) cached.set(address,(async()=>{
      try {
        const response=await fetcher(address,{redirect:'manual',signal:AbortSignal.timeout(12000),headers:{'User-Agent':'GetToken-SEO-Check/1.0'}});
        return {url:address,status:response.status,headers:response.headers,body:await response.text()};
      } catch(error) { return {url:address,status:0,error:String(error.cause?.message||error.message),headers:new Headers(),body:''}; }
    })());
    return cached.get(address);
  }
  const root=await get('/');
  if (!root.status) return {status:'incomplete',productionVerified:false,baseURL:base.origin,checkedAt:new Date().toISOString(),checks:1,issues:[{url:root.url,type:'transport',message:root.error}],note:'Transport failed before site validation. This does not establish a site error.'};
  const all=await parallelMap(ROUTES, async route=>{
    const result=await get(`/${route}`);
    const expected=await readFile(resolve(ROOT,route,'index.html'),'utf8');
    requireCheck(result.status===200,result.url,'http',`Canonical page must return 200; received ${result.status}${result.error?`: ${result.error}`:''}`);
    if (result.status!==200) return {route,title:''};
    requireCheck(result.body===expected,result.url,'content','Published HTML differs from the reviewed build; the homepage and content must remain unchanged.');
    requireCheck(/text\/html/i.test(result.headers.get('content-type')||''),result.url,'mime','Page must be served as HTML.');
    const canonical=tags(result.body,'link').filter(tag=>attr(tag,'rel').toLowerCase()==='canonical').map(tag=>attr(tag,'href'));
    requireCheck(canonical.length===1 && canonical[0]===`${SITE.origin}/${route}`,result.url,'canonical','Page must have one canonical matching the configured production origin.');
    requireCheck(title(result.body)===title(expected),result.url,'title','Published title differs from the reviewed static build.');
    requireCheck(meta(result.body,'description').length===1 && meta(result.body,'description')[0]===meta(expected,'description')[0],result.url,'description','Published description is absent, duplicated or differs from the build.');
    requireCheck([...result.body.matchAll(/<h1\b/gi)].length===1,result.url,'heading','Page must contain one readable H1.');
    const indexing=[...meta(result.body,'robots'),...meta(result.body,'googlebot'),...meta(result.body,'baiduspider'),result.headers.get('x-robots-tag')||''];
    requireCheck(!indexing.some(invalidIndexing),result.url,'indexing','Page is blocked by a noindex directive.');
    if (route) {
      let graph=[];
      let valid=true;
      try { for(const match of result.body.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) { const data=JSON.parse(match[1]);graph.push(...(data['@graph']||[data])); } } catch {valid=false;}
      requireCheck(valid && graph.some(n=>n['@type']==='BreadcrumbList'),result.url,'schema','Structured data must parse and include breadcrumbs.');
      const guide=GUIDES.find(g=>route===`guides/${g.slug}/`);
      const expectedDate=guide?.modified||EDITORIAL.navigationModified;
      const node=graph.find(n=>n['@type']===(guide?'Article':'CollectionPage'));
      requireCheck(node?.dateModified===expectedDate,result.url,'date','Structured modification date differs from the content source.');
      if (guide) {
        requireCheck(node?.headline===guide.title && node?.author?.['@id'] && node?.citation?.length===guide.sources.length,result.url,'article','Article title, author or source citations differ from the content source.');
        requireCheck(result.body.includes(`datetime="${guide.modified}"`) && result.body.includes('GetToken 内容整理'),result.url,'byline','Visible article authorship or update date is missing.');
        const path=new URL(result.url).pathname;
        for(const slug of guide.related) requireCheck(result.body.includes(`guides/${slug}/`),result.url,'links',`Related guide ${slug} is missing.`);
        requireCheck(path===`/guides/${guide.slug}/`,result.url,'route','Guide route is not canonical.');
      }
    }
    return {route,title:title(result.body)};
  });
  const titles=all.map(r=>r.title).filter(Boolean);
  requireCheck(new Set(titles).size===titles.length,base.origin,'titles','Published pages repeat a title.');
  const [robots,sitemap,missing]=await Promise.all([get('/robots.txt'),get('/sitemap.xml'),get('/__gettoken_seo_missing_page__/')]);
  requireCheck(robots.status===200,robots.url,'robots','robots.txt must be reachable.');
  requireCheck(robots.body.split(/\r?\n/).some(line=>line.trim()===`Sitemap: ${SITE.origin}/sitemap.xml`),robots.url,'sitemap','robots.txt must point to the canonical sitemap.');
  for (const route of ROUTES) for(const agent of ['Googlebot','Baiduspider']) requireCheck(robotsAllows(robots.body,agent,`/${route}`),robots.url,'crawl',`${agent} is blocked from /${route}`);
  requireCheck(sitemap.status===200,sitemap.url,'sitemap','Sitemap must be reachable.');
  const blocks=[...sitemap.body.matchAll(/<url>([\s\S]*?)<\/url>/g)].map(m=>m[1]);
  const locations=blocks.map(b=>decode(b.match(/<loc>(.*?)<\/loc>/)?.[1]||''));
  requireCheck(locations.length===ROUTES.length && new Set(locations).size===ROUTES.length && ROUTES.every(route=>locations.includes(`${SITE.origin}/${route}`)),sitemap.url,'sitemap','Sitemap contains missing, duplicate or noncanonical URLs.');
  for(const block of blocks) {
    const address=decode(block.match(/<loc>(.*?)<\/loc>/)?.[1]||'');
    const guide=GUIDES.find(g=>address===`${SITE.origin}/guides/${g.slug}/`);
    const modified=guide?.modified||(address===`${SITE.origin}/navigation/`?EDITORIAL.navigationModified:null);
    if(modified) requireCheck(block.includes(`<lastmod>${modified}</lastmod>`),sitemap.url,'date',`Sitemap date mismatch for ${address}`);
  }
  requireCheck([404,410].includes(missing.status),missing.url,'soft404',`Missing page must return 404/410; received ${missing.status}.`);
  for(const [path,type] of [['assets/gettoken/home.css','text/css'],['assets/gettoken/pages.css','text/css'],['assets/gettoken/logo.png','image/png']]) {
    const response=await get(`/${path}`);
    requireCheck(response.status===200 && (response.headers.get('content-type')||'').includes(type),response.url,'asset','Required CSS or logo is missing or served with the wrong MIME type.');
  }
  if(checkAliases) await parallelMap(ROUTES.filter(Boolean),async route=>{
    for(const path of [`/${route}index.html`, `/${route.slice(0,-1)}`]) {
      const response=await get(path);
      const location=response.headers.get('location');
      requireCheck([301,308].includes(response.status) && location && new URL(location,response.url).href===new URL(`/${route}`,base).href,response.url,'alias','SEO alias must permanently redirect to the canonical directory URL.');
    }
  });
  if(!preview) {
    const response=await get(`http://${base.host}/`);
    const location=response.headers.get('location');
    requireCheck([301,308].includes(response.status) && location && new URL(location,response.url).href===new URL('/',base).href,response.url,'https','HTTP origin must permanently redirect to canonical HTTPS.');
  }
  if(expectedRevision) {
    const deployed=await get('/deployment.json');
    let revision;
    try {revision=JSON.parse(deployed.body).commit;} catch {}
    requireCheck(deployed.status===200 && revision===expectedRevision,deployed.url,'revision','Public domain does not serve the expected deployed commit.');
  }
  return {status:issues.length?'failed':'passed',productionVerified:!preview&&!issues.length,baseURL:base.origin,checkedAt:new Date().toISOString(),checks,issues,note:preview?'Local preview only; production HTTPS, crawler access and indexing remain unverified.':'HTTP checks do not certify search-engine indexing, rankings or field Core Web Vitals.'};
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2);
  const option=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
  const report=await auditLive({baseURL:option('--base')||SITE.origin,preview:args.includes('--preview'),checkAliases:!args.includes('--skip-aliases'),expectedRevision:option('--revision')});
  if(option('--output')) {const path=resolve(option('--output'));await mkdir(dirname(path),{recursive:true});await writeFile(path,`${JSON.stringify(report,null,2)}\n`);}
  console.log(JSON.stringify(report,null,2));
  if(report.status!=='passed')process.exitCode=1;
}
