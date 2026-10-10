#!/usr/bin/env node
// Linux/Docker integration check for the actual deployment template and archive.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir, mkdtemp, readdir, chmod, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { ROOT, ROUTES } from './build-site.mjs';
import { auditLive, curlRequest } from './check-live-seo.mjs';
const run=promisify(execFile);
const image='nginx:1.28-alpine@sha256:a8b39bd9cf0f83869a2162827a0caf6137ddf759d50a171451b335cecc87d236';
const dockerEnv={...process.env};
for(const key of ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'])delete dockerEnv[key];
const docker=(...args)=>run('docker',['--host=unix:///var/run/docker.sock',...args],{env:dockerEnv,maxBuffer:4*1024*1024});
await mkdir(resolve(ROOT,'.impeccable/review'),{recursive:true});
const temporary=await mkdtemp(resolve(ROOT,'.impeccable/review/nginx-test-'));
let container;
async function releasePermissions(path) {
  await chmod(path,0o755);
  for(const entry of await readdir(path,{withFileTypes:true})) {
    const file=join(path,entry.name);
    if(entry.isDirectory())await releasePermissions(file);else await chmod(file,0o644);
  }
}
try {
  await docker('info','--format','{{.ServerVersion}}');
  const archive=join(temporary,'site.tar.gz'),site=join(temporary,'site'),config=join(temporary,'default.conf'),domainConfig=join(temporary,'domain.conf'),snippet=join(temporary,'seo-locations.conf');
  await run(process.execPath,['scripts/package-site.mjs',archive],{cwd:ROOT});
  await mkdir(site);
  await run('tar',['-xzf',archive,'-C',site]);
  await releasePermissions(site);
  const script=await readFile(resolve(ROOT,'scripts/server-deploy.sh'),'utf8');
  const template=script.split('cat > "$config" <<EOF\n')[1]?.split('\nEOF')[0];
  assert.ok(template,'Deployment Nginx template is missing');
  await writeFile(config,template.replaceAll('$site_host','localhost').replaceAll('$site_root/current','/srv/site').replaceAll('$site_root','/srv').replaceAll('\\$','$')+'\n');
  await chmod(config,0o644);
  await writeFile(snippet,await readFile(resolve(ROOT,'scripts/nginx-seo-locations.conf')));
  await chmod(snippet,0o644);
  await writeFile(domainConfig,'server {\n    listen 80;\n    server_name gettoken.cc www.gettoken.cc;\n    root /srv/site;\n    index index.html;\n    location / { try_files $uri $uri/ =404; }\n    location = /preserved-fixture/ { return 200 "existing route"; }\n}\n');
  await chmod(domainConfig,0o644);
  await run('python3',['-c',`import importlib.util,sys\nfrom pathlib import Path\nspec=importlib.util.spec_from_file_location('routing',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)\npath=Path(sys.argv[2]);changes,matched=m.plan_updates('# configuration file '+str(path)+':\\n','/srv/site','/srv/seo-locations.conf',['gettoken.cc','www.gettoken.cc'])\nassert matched==1\nfor file,data in changes.items():m.atomic_write(file,data,file.stat())`,resolve(ROOT,'scripts/configure-seo-routing.py'),domainConfig]);
  const mounts=['--mount',`type=bind,src=${config},dst=/etc/nginx/conf.d/default.conf,readonly`,'--mount',`type=bind,src=${domainConfig},dst=/etc/nginx/conf.d/domain.conf,readonly`,'--mount',`type=bind,src=${snippet},dst=/srv/seo-locations.conf,readonly`,'--mount',`type=bind,src=${site},dst=/srv/site,readonly`];
  await docker('run','--rm',...mounts,'--entrypoint','nginx',image,'-t');
  container=(await docker('run','--detach','--rm','--publish','127.0.0.1::80',...mounts,'--entrypoint','nginx',image,'-g','daemon off;')).stdout.trim();
  const port=(await docker('inspect','--format','{{(index (index .NetworkSettings.Ports "80/tcp") 0).HostPort}}',container)).stdout.trim();
  assert.match(port,/^\d+$/);
  const base=`http://127.0.0.1:${port}`;
  let ready=false;
  for(let retry=0;retry<10;retry++) {
    try {if((await curlRequest(base+'/')).status===200) {ready=true;break;}} catch {}
    await new Promise(done=>setTimeout(done,300));
  }
  assert.ok(ready,'Nginx did not become ready');
  const report=await auditLive({baseURL:base,preview:true});
  assert.deepEqual(report.issues,[],'Canonical pages, redirects, resources and crawl directives must pass on the packaged release');
  let domainChecks=0;
  for(const host of ['gettoken.cc','www.gettoken.cc']) {
    const headers={Host:host};
    const home=await curlRequest(base+'/',{headers});
    assert.equal(home.status,200);
    assert.equal(await home.text(),await readFile(join(site,'index.html'),'utf8'));
    const original=await curlRequest(base+'/preserved-fixture/',{headers});
    assert.equal(await original.text(),'existing route');
    for(const route of ROUTES.filter(Boolean)) {
      const page=await curlRequest(base+'/'+route,{headers});
      assert.equal(page.status,200);
      assert.equal(await page.text(),await readFile(join(site,route,'index.html'),'utf8'));
      const alias=await curlRequest(base+'/'+route+'index.html?utm_source=qa',{headers});
      assert.equal(alias.status,301);
      assert.equal(alias.headers.get('location'),'/'+route+'?utm_source=qa');
      domainChecks+=2;
    }
    domainChecks+=2;
  }
  const query=await curlRequest(base+'/navigation/index.html?utm_source=qa');
  assert.equal(query.status,301);
  assert.equal(query.headers.get('location'),'/navigation/?utm_source=qa');
  const slash=await curlRequest(base+'/guides/claude-code-cost-checklist?utm_source=qa');
  assert.equal(slash.status,301);
  assert.equal(slash.headers.get('location'),'/guides/claude-code-cost-checklist/?utm_source=qa');
  const headers=(await run('curl',['--silent','--show-error','--max-time','5','--header','Accept-Encoding: gzip','--dump-header','-','--output','/dev/null',base+'/navigation/'])).stdout;
  assert.match(headers,/content-encoding:\s*gzip/i);
  assert.match(headers,/vary:\s*Accept-Encoding/i);
  const result={...report,domainChecks,originalDomainContentPreserved:true,gzipVerified:true,queryPreservationVerified:true,nginxImage:image};
  await mkdir(resolve(ROOT,'.impeccable/review/seo'),{recursive:true});
  await writeFile(resolve(ROOT,'.impeccable/review/seo/nginx-smoke.json'),`${JSON.stringify(result,null,2)}\n`);
  console.log(`Nginx integration passed: ${report.checks} HTTP checks and ${domainChecks} domain checks, unchanged homepage, gzip and redirect query preservation. Production remains unverified.`);
} finally {
  if(container)await docker('stop',container).catch(()=>{});
  await rm(temporary,{recursive:true,force:true});
}
