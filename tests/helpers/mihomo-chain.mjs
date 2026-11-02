// Optional integration check: node tests/helpers/mihomo-chain.mjs /path/to/mihomo
// Uses only local TLS and SOCKS fixtures; no real subscriptions or proxy credentials.
import assert from 'node:assert/strict';
import { createServer, connect } from 'node:net';
import { createServer as createHttpsServer } from 'node:https';
import { request } from 'node:http';
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
      events.push({ label, host, port });
      if (forward) {
        assert.equal(host, '127.0.0.1');
        assert.equal(port, residentialPort);
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
let residentialPort;
try {
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem')], { stdio: 'ignore' });
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
  const baseYaml = config.yaml.replace('mixed-port: 7897', `mixed-port: ${mixed}`) + `external-controller: 127.0.0.1:${controller}\n`;
  await writeFile(file, baseYaml);
  child = spawn(binary, ['-d', dir, '-f', file], { env: { ...process.env, SSL_CERT_FILE: join(dir, 'cert.pem') }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', x => { logs += x; }); child.stderr.on('data', x => { logs += x; });
  const api = `http://127.0.0.1:${controller}`;
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      const response = await fetch(`${api}/proxies/${encodeURIComponent('链式节点')}`);
      const group = await response.json();
      ready = group.all?.includes('前置 · PRE-PROXY') && group.all?.includes('住宅 · first') && group.all?.includes('住宅 · second');
      if (ready) assert.ok(!group.hidden);
      if (ready) break;
    } catch {}
    await new Promise(done => setTimeout(done, 50));
  }
  assert.ok(ready, `provider must load: ${logs}`);
  assert.equal(config.yaml.split('  - name: 链式节点').length, 2);
  assert.ok(!config.yaml.includes('hidden:') && !config.yaml.includes('UPSTREAM-AUTO'));
  // Emulate the client applying the chosen front node and dialer relation.
  // The downloaded preparation config itself does not pre-bind a chain.
  const applyClientChain = async frontPort => {
    const front = `  - name: selected-front\n    type: socks5\n    server: 127.0.0.1\n    port: ${frontPort}\n    username: front-user\n    password: front-password\n`;
    const payload = baseYaml.replace('\nproxies:\n', '\nproxies:\n' + front).replace(/    udp: false/g, '    udp: false\n    dialer-proxy: selected-front');
    const response = await fetch(`${api}/configs?force=true`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ payload }) });
    assert.equal(response.status, 204);
  };
  await applyClientChain(firstPort);
  const visit = () => new Promise((resolveVisit, reject) => {
    const req = request({ host: '127.0.0.1', port: mixed, path: 'http://198.51.100.1/check', headers: { Host: '198.51.100.1' }, timeout: 3000 }, res => {
      let body = ''; res.on('data', x => { body += x; }); res.on('end', () => resolveVisit({ status: res.statusCode, body }));
    });
    req.on('timeout', () => req.destroy(new Error('test timeout'))); req.on('error', reject); req.end();
  });
  assert.deepEqual(await visit(), { status: 200, body: 'residential-exit!' });
  assert.deepEqual(events.map(e => e.label), ['front-1', 'residential']);
  assert.equal((await fetch(`${api}/proxies/${encodeURIComponent('链式节点')}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '住宅 · second' }) })).status, 204);
  events.length = 0;
  assert.deepEqual(await visit(), { status: 200, body: 'residential-exit!' });
  assert.deepEqual(events.map(e => e.label), ['front-1', 'residential']);
  version = 2;
  const update = await fetch(`${api}/providers/proxies/upstream`, { method: 'PUT' });
  assert.equal(update.status, 204);
  assert.ok(downloads >= 2);
  const pool = await (await fetch(`${api}/proxies/${encodeURIComponent('链式节点')}`)).json();
  assert.ok(pool.all.includes('前置 · PRE-PROXY') && pool.all.includes('住宅 · second'));
  await applyClientChain(secondPort);
  events.length = 0;
  assert.deepEqual(await visit(), { status: 200, body: 'residential-exit!' });
  assert.deepEqual(events.map(e => e.label), ['front-2', 'residential']);
  for (const socket of sockets) socket.destroy();
  // Stop the selected front proxy; a request must not reach residential directly.
  await new Promise(done => servers[2].close(done));
  events.length = 0;
  try { assert.notEqual((await visit()).status, 200); } catch (e) { if (e.code === 'ERR_ASSERTION') throw e; }
  assert.ok(!events.some(e => e.label === 'residential'));
  console.log(JSON.stringify({ passed: true, checks: ['HTTPS provider download', 'upstream and residential nodes in one visible group', 'no pre-bound residential dialer', 'client-applied two-hop chain', 'switching residential nodes retains chosen client chain', 'provider refresh keeps nodes selectable', 'client can choose another front', 'no direct fallback after selected front failure'] }));
} finally {
  if (child && child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit'); }
  for (const socket of sockets) socket.destroy();
  for (const server of servers) if (server.listening) await new Promise(done => server.close(done));
  await rm(dir, { recursive: true, force: true });
}
