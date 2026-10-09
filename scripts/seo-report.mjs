#!/usr/bin/env node
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { ROOT, ROUTES, generateSite } from './build-site.mjs';
import { SITE } from '../content/site.mjs';
import { GUIDES } from '../content/guides.mjs';
import { KEYWORDS } from '../content/keywords.mjs';
const csv = value => `"${String(value).replace(/"/g,'""')}"`;
export async function exportSeoReport(output = resolve(ROOT,'.impeccable/review/seo')) {
  await generateSite({check:true});
  const pages = [];
  for (const route of ROUTES) {
    const html = await readFile(resolve(ROOT,route,'index.html'),'utf8');
    pages.push({url:new URL(route,`${SITE.origin}/`).href,title:html.match(/<title>(.*?)<\/title>/s)[1],bytes:Buffer.byteLength(html),gzipBytes:gzipSync(html).length,modified:GUIDES.find(g=>route===`guides/${g.slug}/`)?.modified});
  }
  const mapped = [];
  for (const row of KEYWORDS) {
    const address = new URL(row.route,`${SITE.origin}/`);
    if (!ROUTES.includes(address.pathname.slice(1))) throw new Error(`Keyword target is not canonical: ${row.query}`);
    if (address.hash) {
      const html=await readFile(resolve(ROOT,address.pathname.slice(1),'index.html'),'utf8');
      if (!html.includes(`id="${address.hash.slice(1)}"`)) throw new Error(`Missing keyword anchor: ${row.query}`);
    }
    mapped.push({...row,url:address.href});
  }
  await mkdir(output,{recursive:true});
  const report={kind:'static-content-report',productionVerified:false,scope:'Original homepage preserved; independent SEO navigation and articles',pages,keywords:mapped};
  await writeFile(resolve(output,'content-report.json'),`${JSON.stringify(report,null,2)}\n`);
  await writeFile(resolve(output,'submit-urls.txt'),`${pages.map(p=>p.url).join('\n')}\n`);
  const columns=['平台','关键词','目标URL','搜索意图','优先级','检查日期','地区/语言','设备','自然排名','曝光','点击','咨询','成交'];
  const rows=['\ufeff'+columns.map(csv).join(',')];
  for(const engine of ['百度','Google']) for(const row of mapped) rows.push([engine,row.query,row.url,row.intent,row.priority,'','','','','','','',''].map(csv).join(','));
  await writeFile(resolve(output,'ranking-tracker.csv'),`${rows.join('\n')}\n`);
  console.log(`Exported ${pages.length} URLs and ${mapped.length} keyword mappings to ${output}. Rankings and volumes are blank until measured.`);
  return report;
}
if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) await exportSeoReport(resolve(process.argv[2] || resolve(ROOT,'.impeccable/review/seo')));
