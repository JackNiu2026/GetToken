#!/usr/bin/env node
// Exercise the packaged API behind the real Nginx proxy with locally trusted TLS.
// All orders, keys and money are synthetic and temporary; nothing touches production.
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { ROOT } from './build-site.mjs';
const run = promisify(execFile);
const env = { ...process.env };
for (const key of ['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH']) delete env[key];
const endpoint = '--host=unix:///var/run/docker.sock';
const docker = (...args) => run('docker', [endpoint, ...args], { env, maxBuffer: 4 * 1024 * 1024 });
const image = 'nginx:1.28-alpine@sha256:a8b39bd9cf0f83869a2162827a0caf6137ddf759d50a171451b335cecc87d236';
const nodeImage = 'node:22.22.0-bookworm-slim';
await mkdir(join(ROOT, '.impeccable/review'), { recursive: true });
const temp = await mkdtemp(join(ROOT, '.impeccable/review/verify-api-'));
let apiContainer, nginxContainer;
let checks = 0;
try {
  await docker('info', '--format', '{{.ServerVersion}}');
  const apiDir = join(temp, 'api'), dataDir = join(temp, 'data');
  await mkdir(apiDir); await mkdir(dataDir);
  await run(process.execPath, ['scripts/package-verify.mjs', join(temp, 'api.tar.gz')], { cwd: ROOT });
  await run('tar', ['-xzf', join(temp, 'api.tar.gz'), '-C', apiDir]);
  const cert = join(temp, 'server.crt'), key = join(temp, 'server.key');
  await run('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost']);
  const snippet = join(temp, 'locations.conf');
  await writeFile(snippet, await readFile(join(ROOT, 'scripts/nginx-seo-locations.conf')));
  const conf = join(temp, 'default.conf');
  await writeFile(conf, `server {
 listen 443 ssl;
 server_name localhost;
 ssl_certificate /run/verify-test/server.crt;
 ssl_certificate_key /run/verify-test/server.key;
 include /run/verify-test/locations.conf;
 location / { return 404; }
}\n`);
  // The service user is the same UID as the managed executor; CI runners use
  // their own UID. Only the temporary data mount is writable.
  const uid = process.getuid(), gid = process.getgid();
  env.VERIFY_SECRET = randomBytes(32).toString('hex');
  const mounts = ['--mount', `type=bind,src=${apiDir},dst=/app,readonly`, '--mount', `type=bind,src=${dataDir},dst=/data`];
  apiContainer = (await docker('run', '--detach', '--rm', '--user', `${uid}:${gid}`, '--read-only', '--publish', '127.0.0.1::443', ...mounts,
    '--env', 'VERIFY_SECRET', '--env', 'VERIFY_PAY_MODE=mock', '--env', 'VERIFY_HOST=127.0.0.1', '--env', 'VERIFY_DATA_DIR=/data', nodeImage,
    'node', '--disable-warning=ExperimentalWarning', '/app/server/verify/server.mjs')).stdout.trim();
  assert.equal((await docker('exec', apiContainer, 'node', '--version')).stdout.trim(), 'v22.22.0');
  execFileSync('docker', [endpoint, 'exec', '-i', apiContainer, 'node', '--disable-warning=ExperimentalWarning', '/app/server/verify/cli.mjs', 'passwd'],
    { env, input: 'verify-integration-test-only\nverify-integration-test-only\n', stdio: ['pipe', 'pipe', 'pipe'] });
  nginxContainer = (await docker('run', '--detach', '--rm', '--network', `container:${apiContainer}`,
    '--mount', `type=bind,src=${conf},dst=/etc/nginx/conf.d/default.conf,readonly`,
    '--mount', `type=bind,src=${temp},dst=/run/verify-test,readonly`, image)).stdout.trim();
  const port = (await docker('inspect', '--format', '{{(index (index .NetworkSettings.Ports "443/tcp") 0).HostPort}}', apiContainer)).stdout.trim();
  let base = `https://127.0.0.1:${port}/api/verify/`;
  let cookie;
  const access = new Map();
  async function call(path, { method = 'GET', body, admin = false } = {}) {
    const id = randomBytes(8).toString('hex');
    const headers = join(temp, `${id}.headers`), output = join(temp, `${id}.json`);
    const args = ['--silent', '--show-error', '--max-time', '10', '--cacert', cert, '--dump-header', headers, '--output', output, '--write-out', '%{http_code}', '--request', method];
    if (body !== undefined) args.push('--header', 'Content-Type: application/json', '--data', JSON.stringify(body));
    if (path.startsWith('orders/')) args.push('--header', `X-GetToken-Order-Access: ${access.get(path.split('/')[1]) || ''}`);
    if (admin) args.push('--cookie', cookie, '--header', 'X-GetToken-Admin: 1');
    const result = await run('curl', [...args, base + path]);
    const rawHeaders = await readFile(headers, 'utf8');
    const setCookie = /^set-cookie:\s*([^;\r\n]+)/im.exec(rawHeaders)?.[1];
    if (setCookie) cookie = setCookie;
    const text = await readFile(output, 'utf8');
    const data = JSON.parse(text);
    if (data.accessToken) access.set(data.id, data.accessToken);
    return { status: Number(result.stdout), data };
  }
  let healthy = false;
  for (let i = 0; i < 20; i += 1) {
    try { healthy = (await call('health')).data.ok === true; } catch {}
    if (healthy) break;
    await new Promise(r => setTimeout(r, 250));
  }
  assert.ok(healthy, 'packaged service must boot and be reachable through Nginx'); checks++;
  assert.equal((await call('config')).data.mode, 'mock'); checks++;
  assert.equal((await call('admin/orders')).status, 401); checks++;
  assert.equal((await call('admin/login', { method: 'POST', body: { password: 'verify-integration-test-only' } })).status, 200); checks++;
  const create = async showPublic => {
    const response = await call('orders', { method: 'POST', body: { code: 'sk-integration-' + 'q'.repeat(45), agree: true, showPublic, channel: 'mock' } });
    assert.equal(response.status, 201); checks++;
    return response.data;
  };
  const first = await create(true);
  assert.equal(first.status, 'unpaid'); checks++;
  assert.equal(first.payment.amount, 33000); checks++;
  assert.equal((await call(`admin/orders/${first.id}/decision`, { method: 'POST', body: { result: 'passed' }, admin: true })).status, 409); checks++;
  assert.equal((await call(`admin/orders/${first.id}/mock-pay`, { method: 'POST', body: {}, admin: true })).data.status, 'reviewing'); checks++;
  assert.equal((await call(`orders/${first.id}`)).data.status, 'reviewing'); checks++;
  assert.equal((await call(`admin/orders/${first.id}/decision`, { method: 'POST', body: { result: 'passed' }, admin: true })).data.status, 'passed'); checks++;
  assert.equal((await call('feed')).data.items.length, 1); checks++;
  const failed = await create(false);
  await call(`admin/orders/${failed.id}/mock-pay`, { method: 'POST', body: {}, admin: true });
  const result = await call(`admin/orders/${failed.id}/decision`, { method: 'POST', body: { result: 'failed', reason: 'integration test' }, admin: true });
  assert.equal(result.status, 200); checks++;
  assert.equal(result.data.refunds[0].amount, 30000); checks++;
  assert.equal(result.data.refunds[0].status, 'success'); checks++;
  const publicResult = (await call(`orders/${failed.id}`)).data;
  assert.equal(publicResult.refund.amount, 30000); checks++;
  assert.equal(publicResult.refund.status, 'success'); checks++;
  assert.equal((await call('feed')).data.items.length, 1); checks++;
  // Restart the actual entry point on the persisted database and recheck history.
  await docker('restart', apiContainer);
  // A restarted container gets a new network namespace. Reattach Nginx to it
  // and read the currently published ephemeral port instead of using the old one.
  await docker('restart', nginxContainer);
  const restartedPort = (await docker('inspect', '--format', '{{(index (index .NetworkSettings.Ports "443/tcp") 0).HostPort}}', apiContainer)).stdout.trim();
  base = `https://127.0.0.1:${restartedPort}/api/verify/`;
  let restored;
  for (let i = 0; i < 20; i += 1) {
    try { restored = await call(`orders/${failed.id}`); } catch {}
    if (restored?.status === 200) break;
    await new Promise(r => setTimeout(r, 250));
  }
  assert.equal(restored?.status, 200, 'API must recover after restart');
  assert.equal(restored.data.status, 'failed'); checks++;
  assert.equal(restored.data.refund.status, 'success'); checks++;
  const report = { passed: true, checks, mode: 'mock', runtime: 'v22.22.0', nginxImage: image, tlsVerified: true, persistedHistoryVerified: true, productionVerified: false };
  await writeFile(join(ROOT, '.impeccable/review/verify-api-smoke.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`Verify API integration passed: ${checks} checks, Node 22.22.0, real Nginx/TLS, persisted orders, review and refund. Mock payments only.`);
} finally {
  if (nginxContainer) await docker('stop', nginxContainer).catch(() => {});
  if (apiContainer) await docker('stop', apiContainer).catch(() => {});
  await rm(temp, { recursive: true, force: true });
}
