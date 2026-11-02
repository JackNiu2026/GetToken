// Optional integration check: node tests/helpers/mihomo-chain.mjs /path/to/mihomo
// Uses only local TLS and SOCKS fixtures; no real subscriptions or proxy credentials.
import assert from 'node:assert/strict';
import { createServer, connect } from 'node:net';
import { createServer as createHttpsServer } from 'node:https';
import { request, createServer as createHttpServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { buildSubscription } from '../../assets/gettoken/clash-config.mjs';

const binary = resolve(process.argv[2] || 'mihomo');
const dir = await mkdtemp(join(tmpdir(), 'gettoken-chain-'));
const sockets = new Set();
const events = [];
const servers = [];
let child;
let logs = '';
async function listen(server) {
  servers.push(server);
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  return server.address().port;
}
async function freePort() {
  const server = createServer();
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const port = server.address().port;
  await new Promise(done => server.close(done));
  return port;
}
async function exact(socket, count) {
  const parts = [];
  let length = 0;
  while (length < count) {
    const part = socket.read(count - length);
    if (part) { parts.push(part); length += part.length; continue; }
    if (socket.destroyed || socket.readableEnded) throw new Error('fixture socket closed');
    await once(socket, 'readable');
  }
  return Buffer.concat(parts);
}
function track(socket) {
  sockets.add(socket);
  socket.on('error', () => {});
  socket.on('close', () => sockets.delete(socket));
  socket.setTimeout(10000, () => socket.destroy());
}
async function socks(label, username, password, forward) {
  return listen(createServer(socket => {
    track(socket);
    (async () => {
      const hello = await exact(socket, 2);
      assert.equal(hello[0], 5);
      assert.ok((await exact(socket, hello[1])).includes(2));
      socket.write(Buffer.from([5, 2]));
      const auth = await exact(socket, 2);
      assert.equal(auth[0], 1);
      assert.equal((await exact(socket, auth[1])).toString(), username);
      const passwordLength = (await exact(socket, 1))[0];
      assert.equal((await exact(socket, passwordLength)).toString(), password);
      socket.write(Buffer.from([1, 0]));
      const header = await exact(socket, 4);
      assert.equal(header[1], 1);
      let host;
      if (header[3] === 1) host = [...await exact(socket, 4)].join('.');
      else if (header[3] === 3) host = (await exact(socket, (await exact(socket, 1))[0])).toString();
      else throw new Error('unexpected address type');
      const port = (await exact(socket, 2)).readUInt16BE();
      if (!forward || port === residentialPort) events.push({ label, host, port });
      if (forward) {
        assert.equal(host, '127.0.0.1');
        assert.ok([residentialPort, healthPort].includes(port));
        const target = connect(port, host);
        track(target);
        await once(target, 'connect');
        socket.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0]));
        socket.pipe(target).pipe(socket);
      } else {
        assert.equal(host, '198.51.100.1');
        assert.equal(port, 80);
        socket.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0]));
        socket.once('data', () => socket.end('HTTP/1.1 200 OK\r\nContent-Length: 17\r\nConnection: close\r\n\r\nresidential-exit!'));
      }
    })().catch(error => { logs += `fixture error: ${error.message}\n`; socket.destroy(); });
  }));
}
let residentialPort, healthPort;
let healthHits = 0;
try {
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem')], { stdio: 'ignore' });
  healthPort = await listen(createHttpServer((req, res) => { healthHits++; res.writeHead(204); res.end(); }));
  residentialPort = await socks('residential', 'residential-user', 'residential-password', false);
  const firstPort = await socks('front-1', 'front-user', 'front-password', true);
  const secondPort = await socks('front-2', 'front-user', 'front-password', true);
  let version = 1;
  let downloads = 0;
  const providerPort = await listen(createHttpsServer({ key: await readFile(join(dir, 'key.pem')), cert: await readFile(join(dir, 'cert.pem')) }, (req, res) => {
    downloads++;
    assert.equal(req.url, '/sub?token=fixture');
    // A full Clash document is accepted; only its proxies list should be imported.
    res.writeHead(200, { 'Content-Type': 'text/yaml' });
    res.end(`proxies:\n  - name: PRE-PROXY\n    type: socks5\n    server: 127.0.0.1\n    port: ${version === 1 ? firstPort : secondPort}\n    username: front-user\n    password: front-password\n    dialer-proxy: missing-old-group\nproxy-groups:\n  - name: ignored-source-group\n    type: select\n    proxies: [PRE-PROXY]\nrules: [MATCH,ignored-source-group]\n`);
  }));
  const mixed = await freePort(), controller = await freePort();
  const config = buildSubscription({ source: `socks5://residential-user:residential-password@127.0.0.1:${residentialPort}#first\nsocks5://residential-user:residential-password@127.0.0.1:${residentialPort}#second`, connection: 'chain', upstreamUrl: `https://127.0.0.1:${providerPort}/sub?token=fixture` });
  const file = join(dir, 'config.yaml');
  await writeFile(file, config.yaml.replace('mixed-port: 7897', `mixed-port: ${mixed}`).replace('https://www.gstatic.com/generate_204', `http://127.0.0.1:${healthPort}/health`) + `external-controller: 127.0.0.1:${controller}\n`);
  child = spawn(binary, ['-d', dir, '-f', file], { env: { ...process.env, SSL_CERT_FILE: join(dir, 'cert.pem') }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', x => { logs += x; }); child.stderr.on('data', x => { logs += x; });
  const api = `http://127.0.0.1:${controller}`;
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      const response = await fetch(`${api}/proxies/UPSTREAM-AUTO`);
      const group = await response.json();
      ready = group.all?.includes('前置 · PRE-PROXY') && group.now === '前置 · PRE-PROXY';
      if (ready) { assert.equal(group.hidden, true); assert.equal(group.emptyFallback, 'REJECT'); }
      if (ready) break;
    } catch {}
    await new Promise(done => setTimeout(done, 50));
  }
  assert.ok(ready, `provider must load: ${logs}`);
  for (let i = 0; i < 50 && !healthHits; i++) await new Promise(done => setTimeout(done, 50));
  assert.ok(healthHits > 0, 'background health checks must actually execute');
  const visit = () => new Promise((resolveVisit, reject) => {
    const req = request({ host: '127.0.0.1', port: mixed, path: 'http://198.51.100.1/check', headers: { Host: '198.51.100.1' }, timeout: 3000 }, res => {
      let body = ''; res.on('data', x => { body += x; }); res.on('end', () => resolveVisit({ status: res.statusCode, body }));
    });
    req.on('timeout', () => req.destroy(new Error('test timeout'))); req.on('error', reject); req.end();
  });
  assert.deepEqual(await visit(), { status: 200, body: 'residential-exit!' });
  assert.deepEqual(events.map(e => e.label), ['front-1', 'residential']);
  assert.equal((await fetch(`${api}/proxies/${encodeURIComponent('链式出口')}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '住宅 · second' }) })).status, 204);
  events.length = 0;
  assert.deepEqual(await visit(), { status: 200, body: 'residential-exit!' });
  assert.deepEqual(events.map(e => e.label), ['front-1', 'residential']);
  assert.equal((await (await fetch(`${api}/proxies/UPSTREAM-AUTO`)).json()).now, '前置 · PRE-PROXY');
  version = 2;
  const update = await fetch(`${api}/providers/proxies/upstream`, { method: 'PUT' });
  assert.equal(update.status, 204);
  assert.ok(downloads >= 2);
  let refreshed = false;
  for (let i = 0; i < 150; i++) {
    events.length = 0;
    assert.deepEqual(await visit(), { status: 200, body: 'residential-exit!' });
    refreshed = events[0]?.label === 'front-2';
    if (refreshed) break;
    await new Promise(done => setTimeout(done, 100));
  }
  assert.ok(refreshed, 'automatic group must pick up refreshed provider nodes after its selection cache expires');
  assert.deepEqual(events.map(e => e.label), ['front-2', 'residential']);
  for (const socket of sockets) socket.destroy();
  // Stop the selected front proxy; a request must not reach residential directly.
  await new Promise(done => servers[3].close(done));
  events.length = 0;
  try { assert.notEqual((await visit()).status, 200); } catch (e) { if (e.code === 'ERR_ASSERTION') throw e; }
  assert.ok(!events.some(e => e.label === 'residential'));
  console.log(JSON.stringify({ passed: true, checks: ['HTTPS provider download', 'full Clash subscription extraction', 'upstream auth', 'residential auth', 'actual two-hop order', 'provider refresh switches front node', 'automatic front selection without manual switching', 'hidden internal group', 'switching exit retains the front chain', 'no direct fallback on front failure', 'prefix prevents group collision', 'stale source dialer reference overridden'] }));
} finally {
  if (child && child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit'); }
  for (const socket of sockets) socket.destroy();
  for (const server of servers) if (server.listening) await new Promise(done => server.close(done));
  await rm(dir, { recursive: true, force: true });
}
