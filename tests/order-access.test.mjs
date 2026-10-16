import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/verify/store.mjs';
import { createService } from '../server/verify/service.mjs';
import { createApp } from '../server/verify/app.mjs';
import { mockProvider } from '../server/verify/pay/mock.mjs';
import { validOrderAccess, issueOrderAccess, assertAccessMigration } from '../server/verify/access.mjs';

function fixture(t) {
  const store = openStore(':memory:'); t.after(() => store.close());
  const config = { mode: 'mock', secret: randomBytes(32) }, providers = { mock: mockProvider() };
  const service = createService({ store, config, providers });
  return { store, config, providers, service, create: () => service.createOrder({ code: 'sk-synthetic-' + 'a'.repeat(42), agree: true, channel: 'mock' }) };
}

test('lookup and QR creation require the matching bearer; no secret is returned again', async t => {
  const f = fixture(t), a = await f.create(), b = await f.create();
  const server = createServer(createApp(f));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise(r => server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}/api/verify/`;
  for (const key of ['', b.accessToken, 'bad']) {
    for (const method of ['GET', 'POST']) {
      const r = await fetch(base + `orders/${a.id}${method === 'POST' ? '/payments' : ''}`, {
        method, headers: { 'X-GetToken-Order-Access': key, 'Content-Type': 'application/json' },
        body: method === 'POST' ? JSON.stringify({ channel: 'mock' }) : undefined,
      });
      assert.equal(r.status, 403);
      assert.equal(r.headers.get('cache-control'), 'no-store');
      assert.match(r.headers.get('x-robots-tag'), /noindex/);
    }
  }
  const r = await fetch(base + `orders/${a.id}`, { headers: { 'X-GetToken-Order-Access': a.accessToken } });
  assert.equal(r.status, 200);
  const data = await r.json();
  assert.equal(data.id, a.id); assert.equal(data.accessToken, undefined); assert.equal(data.access_hash, undefined);
  assert.notEqual(f.store.get('select access_hash from orders where id = ?', a.id).access_hash, a.accessToken);
  assert.equal((await fetch(base + `orders/${a.id}?access=${a.accessToken}`)).status, 403, 'query-string tokens are never accepted');
  assert.equal((await fetch(base + 'admin/orders')).status, 401);
});

test('migration blocks until recovery issued; recovery is private, rotatable and preserves finances', async t => {
  const f = fixture(t), order = await f.create();
  const dir = mkdtempSync(join(tmpdir(), 'gettoken-access-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  f.store.run('update orders set access_hash = null where id = ?', order.id);
  assert.throws(() => assertAccessMigration(f.store), /1 legacy orders/);
  const output = join(dir, 'query.json');
  issueOrderAccess({ store: f.store, id: order.id, output, origin: 'https://gettoken.cc' });
  assertAccessMigration(f.store);
  assert.equal(statSync(output).mode & 0o777, 0o600);
  const link = new URL(JSON.parse(readFileSync(output)).queryLink);
  const first = new URLSearchParams(link.hash.slice(1)).get('access');
  assert.equal(link.searchParams.get('access'), null);
  assert.ok(validOrderAccess(order.id, first, f.store.get('select access_hash from orders where id = ?', order.id).access_hash));
  assert.throws(() => issueOrderAccess({ store: f.store, id: order.id, output, origin: link.origin }), /already issued/);
  assert.throws(() => issueOrderAccess({ store: f.store, id: order.id, output, origin: link.origin, rotate: true }), /EEXIST/);
  issueOrderAccess({ store: f.store, id: order.id, output: join(dir, 'rotated.json'), origin: link.origin, rotate: true });
  assert.equal(validOrderAccess(order.id, first, f.store.get('select access_hash from orders where id = ?', order.id).access_hash), false);
  assert.equal(f.store.get('select count(*) as n from payments').n, 1);
  assert.equal(f.service.adminDetail(order.id).status, 'unpaid');
  assert.ok(!JSON.stringify(f.store.all('select * from events')).includes(first));
});
