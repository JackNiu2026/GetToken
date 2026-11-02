import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseProxies, buildClashConfig, MAX_PROXIES, SUBSCRIPTION_DAYS } from '../assets/gettoken/clash-config.mjs';
import { openStore } from '../server/verify/store.mjs';
import { createApp } from '../server/verify/app.mjs';
import { purgeClashSubscriptions } from '../server/verify/clash.mjs';
import { maintainBackups } from '../server/verify/backup.mjs';

test('SOCKS5 formats, percent-encoded credentials, IPv6 and duplicate names convert without credential loss', () => {
  const rows = parseProxies('socks5://a%40b:p%3Aa%23%25@proxy.example:1080#香港\n[2001:db8::1]:1081:demo:pass:word\nsocks5://203.0.113.2:1080#香港\nuser:pass@203.0.113.3:1080\n203.0.113.4:1080');
  assert.deepEqual(rows[0], { name: '香港', host: 'proxy.example', port: 1080, username: 'a@b', password: 'p:a#%' });
  assert.equal(rows[1].host, '2001:db8::1');
  assert.equal(rows[1].password, 'pass:word');
  assert.equal(rows[2].name, '香港 (2)');
  assert.equal(rows[3].username, 'user');
  assert.equal(rows[4].password, '');
  assert.equal(parseProxies('203.0.113.10:1080:user:p@ss')[0].password, 'p@ss');
  assert.equal(parseProxies('203.0.113.10:1080:user:p://ss')[0].password, 'p://ss');
});

test('invalid inputs report the line number without reflecting secrets', () => {
  for (const input of ['socks5://203.0.113.2', '203.0.113.2:65536', '999.1.2.3:1080', '203.0.113.02:1080', '[bad:ip]:1080', 'https://secret:password@proxy.example:1080', 'socks5://u@proxy.example:1080', 'socks5://u:p@proxy.example:1080/a', 'socks5://u:%ZZ@proxy.example:1080', 'socks5://u:%0Aevil@proxy.example:1080']) {
    assert.throws(() => parseProxies(`\n203.0.113.1:1080\n${input}`), e => /^第 3 行：/.test(e.message) && !e.message.includes('secret') && !e.message.includes('%ZZ'));
  }
  assert.throws(() => parseProxies(''), /至少一个/);
  assert.throws(() => parseProxies(Array(MAX_PROXIES + 1).fill('proxy.example:1080').join('\n')), /最多/);
  assert.throws(() => buildClashConfig({ source: 'proxy.example:1080', name: 'x\nrules: []' }), /订阅名称/);
  for (const char of ['\u0085', '\u2028', '\u2029', '\ud800']) {
    assert.throws(() => buildClashConfig({ source: 'proxy.example:1080', name: `safe${char}allow-lan: true` }), /订阅名称/);
  }
});

test('YAML escapes credentials and node names and keeps a usable selector and match rule', () => {
  const { yaml, count } = buildClashConfig({ source: 'socks5://u:p%22%5C%3A%23@proxy.example:1080#PROXY\nsocks5://proxy.example:1081#DIRECT', udp: true });
  assert.equal(count, 2);
  assert.ok(yaml.includes('password: "p\\"\\\\:#"'));
  assert.ok(yaml.includes('name: "PROXY (2)"'));
  assert.ok(yaml.includes('name: "DIRECT (2)"'));
  assert.ok(yaml.includes('udp: true'));
  assert.ok(yaml.endsWith('rules:\n  - MATCH,PROXY\n'));
  assert.ok(!yaml.includes('external-controller'));
});

async function fixture(t, file = ':memory:', secret = randomBytes(32)) {
  let time = Date.UTC(2026, 10, 2);
  const store = openStore(file);
  const config = { secret, origin: 'https://gettoken.cc' };
  const server = createServer(createApp({ store, config, service: {}, providers: {}, now: () => time }));
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.closeAllConnections(); await new Promise(done => server.close(done)); store.close(); });
  const create = (body = { source: 'socks5://demo:private-password@203.0.113.1:1080#我的节点' }, headers = {}) => fetch(`${base}/api/clash/subscriptions`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-GetToken-Clash': '1', Origin: config.origin, ...headers }, body: JSON.stringify(body) });
  return { store, base, create, config, advance: ms => { time += ms; } };
}

test('subscription HTTP URL serves actual YAML, HEAD metadata and management-token revocation', async t => {
  const f = await fixture(t);
  const created = await f.create();
  assert.equal(created.status, 201);
  const data = await created.json();
  assert.match(data.path, /^\/api\/clash\/subscriptions\/[\w-]{43}$/);
  assert.ok(!JSON.stringify(data).includes('private-password'));
  const row = f.store.get('select * from clash_subscriptions');
  assert.ok(!JSON.stringify(row).includes('private-password'));
  assert.ok(!JSON.stringify(row).includes(data.manageToken));
  const loaded = await fetch(f.base + data.path);
  assert.equal(loaded.status, 200);
  assert.match(loaded.headers.get('content-type'), /yaml/);
  assert.equal(loaded.headers.get('cache-control'), 'no-store');
  assert.match(await loaded.text(), /password: "private-password"/);
  const head = await fetch(f.base + data.path, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  assert.equal((await fetch(f.base + data.path, { method: 'DELETE' })).status, 403);
  assert.equal((await fetch(f.base + data.path, { method: 'DELETE', headers: { 'X-GetToken-Clash-Manage': data.manageToken } })).status, 200);
  assert.equal((await fetch(f.base + data.path)).status, 404);
  assert.equal(f.store.get('select count(*) as n from clash_subscriptions').n, 0);
});

test('expired links stop serving and encrypted records survive service restarts with the same key', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'gettoken-clash-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const f = await fixture(t, join(dir, 'verify.db'));
  const data = await (await f.create()).json();
  const reopened = openStore(join(dir, 'verify.db'));
  assert.equal(reopened.get('select count(*) as n from clash_subscriptions').n, 1);
  reopened.close();
  const second = await fixture(t, join(dir, 'verify.db'), f.config.secret);
  assert.equal((await fetch(second.base + data.path)).status, 200);
  f.advance(SUBSCRIPTION_DAYS * 86400_000);
  assert.equal((await fetch(f.base + data.path)).status, 404);
  purgeClashSubscriptions(f.store, data.expiresAt);
  assert.equal(f.store.get('select count(*) as n from clash_subscriptions').n, 0);
});

test('subscription creation rejects cross-origin requests, malformed input and abuse', async t => {
  const f = await fixture(t);
  assert.equal((await f.create(undefined, { Origin: 'https://elsewhere.example' })).status, 403);
  assert.equal((await f.create(undefined, { 'X-GetToken-Clash': '' })).status, 403);
  assert.equal((await f.create({ source: 'bad' })).status, 400);
  assert.equal((await f.create({ source: 'x'.repeat(70000) })).status, 413);
  for (let i = 0; i < 18; i++) assert.equal((await f.create()).status, 201);
  assert.equal((await f.create()).status, 429);
  f.advance(3600_001);
  assert.equal((await f.create()).status, 201);
  assert.equal((await fetch(`${f.base}/api/clash/subscriptions/not-a-token`)).status, 404);
});

test('managed backups cannot resurrect revoked or expired subscription credentials', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gettoken-clash-backup-'));
  const store = openStore(join(dir, 'verify.db'));
  const now = Date.UTC(2026, 10, 2);
  try {
    store.run('insert into clash_subscriptions values (?, ?, ?, ?)', 'revoked', 'manage', 'ciphertext', now + 86400_000);
    store.run('insert into clash_subscriptions values (?, ?, ?, ?)', 'expired', 'manage', 'ciphertext', now + 1000);
    maintainBackups({ store, dataDir: dir, now });
    store.run('delete from clash_subscriptions where token_hash = ?', 'revoked');
    maintainBackups({ store, dataDir: dir, now: now + 2000 });
    const backup = openStore(join(dir, 'backups/verify-2026-11-02.db'));
    try { assert.equal(backup.get('select count(*) as n from clash_subscriptions').n, 0); }
    finally { backup.close(); }
  } finally { store.close(); await rm(dir, { recursive: true, force: true }); }
});
