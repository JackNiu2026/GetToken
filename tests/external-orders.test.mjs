import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { openStore } from '../server/verify/store.mjs';
import { createService } from '../server/verify/service.mjs';
import { createApp } from '../server/verify/app.mjs';
import { loadConfig } from '../server/verify/config.mjs';
import { hashPassword, openCode } from '../server/verify/secure.mjs';
import { maintainBackups } from '../server/verify/backup.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
const CODE = 'sk-ant-sid01-' + 'a'.repeat(200);
const REFERENCE = '1234567890123456789';
function fixture(t) {
  let time = Date.UTC(2026, 9, 17);
  const store = openStore(':memory:'); t.after(() => store.close());
  const config = loadConfig({ VERIFY_SECRET: randomBytes(32).toString('hex'), VERIFY_PAY_MODE: 'off' });
  const providers = {};
  const service = createService({ store, config, providers, now: () => time });
  const create = (extra = {}) => service.createExternalOrder({ code: CODE, reference: REFERENCE, agree: true, ...extra });
  store.setSetting('admin_password', hashPassword('synthetic-password-only'));
  return { store, config, providers, service, create, advance: ms => { time += ms; } };
}

test('Taobao intake encrypts reference and credential; duplicates cannot expose access', async t => {
  const f = fixture(t), o = f.create();
  assert.equal(o.status, 'submitted'); assert.equal(o.payment, undefined); assert.equal(o.paidAt, null); assert.equal(o.fees, null);
  assert.equal(o.external.source, 'taobao'); assert.equal(o.external.reference, '尾号 6789');
  assert.ok(!JSON.stringify(o).includes(CODE)); assert.ok(!JSON.stringify(o).includes(REFERENCE));
  const e = f.store.get('select * from external_orders');
  assert.equal(openCode(f.config.secret, e.reference_sealed), REFERENCE);
  assert.ok(!JSON.stringify(e).includes(REFERENCE));
  assert.equal(f.service.adminDetail(o.id).external.reference, REFERENCE);
  assert.equal(f.service.adminDetail(o.id).code, CODE);
  assert.equal(f.service.adminList({ q: REFERENCE }).items[0].id, o.id);
  assert.throws(() => f.create(), error => error.status === 409 && !error.message.includes(o.id) && !error.message.includes(o.accessToken));
  await assert.rejects(f.service.requestPayment(o.id, 'wechat'), error => error.status === 503);
  assert.throws(() => f.service.decide(o.id, 'passed', 'premature'), error => error.status === 409);
  assert.equal(f.store.get('select count(*) as n from payments').n, 0);
  assert.equal(f.store.get('select count(*) as n from refunds').n, 0);
});

test('manual checking, delivery and Taobao refund registration never call payment providers', async t => {
  const f = fixture(t), o = f.create();
  assert.throws(() => f.service.checkExternalOrder(o.id, true, ''), /核单记录/);
  assert.throws(() => f.service.checkExternalOrder(o.id, 'true', 'check'), /结果不正确/);
  f.service.checkExternalOrder(o.id, true, 'Synthetic purchase and ownership checked');
  const checked = await f.service.lookup(o.id);
  assert.equal(checked.status, 'reviewing'); assert.equal(checked.dueAt - checked.paidAt, 24 * 3600000);
  assert.throws(() => f.service.checkExternalOrder(o.id, true, 'twice'), error => error.status === 409);
  assert.throws(() => f.service.decide(o.id, 'failed'), /证据摘要/);
  f.service.decide(o.id, 'failed', 'Synthetic unsuccessful delivery');
  await f.service.tick();
  assert.equal((await f.service.lookup(o.id)).refund.status, 'pending');
  assert.equal(f.store.get('select count(*) as n from refunds').n, 0);
  assert.throws(() => f.service.recordExternalRefund(o.id, ''), /凭证/);
  f.service.recordExternalRefund(o.id, 'Synthetic original Taobao refund checked');
  assert.equal((await f.service.lookup(o.id)).refund.status, 'success');
  assert.throws(() => f.service.recordExternalRefund(o.id, 'again'), error => error.status === 409);
  const passed = f.create({ reference: '2234567890123456789', showPublic: true });
  f.service.checkExternalOrder(passed.id, true, 'Synthetic check');
  f.service.decide(passed.id, 'passed', 'Synthetic delivery');
  assert.equal((await f.service.lookup(passed.id)).reason, 'Synthetic delivery');
  assert.equal(f.service.feed().items.length, 1);
  assert.equal(f.store.get('select count(*) as n from payments').n, 0);
});

test('intake is independently pausable, requires an operator, and accepts Taobao only', t => {
  const f = fixture(t);
  assert.equal(f.service.acceptingExternalOrders(), true);
  assert.equal(f.service.acceptingNewOrders(), false);
  for (const extra of [{ source: 'wechat' }, { source: 'alipay' }, { reference: 'not-a-number' }, { agree: false }, { code: 'bad' }]) assert.throws(() => f.create(extra));
  const paused = createService({ ...f, config: { ...f.config, acceptExternalOrders: false } });
  assert.equal(paused.acceptingExternalOrders(), false);
  assert.throws(() => paused.createExternalOrder({ code: CODE, reference: REFERENCE, agree: true }), error => error.status === 503);
  f.store.run("delete from settings where key = 'admin_password'");
  assert.throws(() => f.create(), error => error.status === 503);
  assert.throws(() => loadConfig({ VERIFY_SECRET: 'a'.repeat(64), VERIFY_ACCEPT_EXTERNAL_ORDERS: 'yes' }), /true or false/);
});

test('rejected and overdue unchecked orders are private and secrets are scrubbed from backups', async t => {
  const f = fixture(t), o = f.create();
  const rejected = f.create({ reference: '2234567890123456789' });
  f.service.checkExternalOrder(rejected.id, false, 'Synthetic reference mismatch');
  assert.equal((await f.service.lookup(rejected.id)).reason, 'Synthetic reference mismatch');
  assert.equal(f.service.feed().today.processed, 0);
  assert.throws(() => f.service.recordExternalRefund(rejected.id, 'not a refund'), error => error.status === 409);
  const dir = mkdtempSync(join(tmpdir(), 'gettoken-external-backup-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const now = Date.UTC(2026, 9, 17);
  maintainBackups({ store: f.store, dataDir: dir, now });
  f.advance(8 * 86400000); await f.service.tick();
  assert.equal((await f.service.lookup(o.id)).status, 'rejected');
  assert.equal(f.service.adminDetail(o.id).code, null);
  assert.throws(() => f.service.checkExternalOrder(o.id, true, 'late'), error => error.status === 409);
  maintainBackups({ store: f.store, dataDir: dir, now: now + 8 * 86400000 });
  const backup = new DatabaseSync(join(dir, 'backups/verify-2026-10-17.db'));
  try { assert.equal(backup.prepare('select count(*) as n from orders where code_sealed is not null').get().n, 0); } finally { backup.close(); }
});

test('HTTP: private lookup, authenticated manual check, CSRF guard and disabled payment endpoint', async t => {
  const f = fixture(t), server = createServer(createApp(f));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise(r => server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}/api/verify/`;
  const post = (path, body, headers = {}) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const cfg = await (await fetch(base + 'config')).json();
  assert.equal(cfg.intakeMode, 'external'); assert.equal(cfg.acceptingOrders, true); assert.deepEqual(cfg.channels, []);
  const created = await post('orders', { code: CODE, reference: REFERENCE, agree: true }); assert.equal(created.status, 201);
  const order = await created.json(), privateHeaders = { 'X-GetToken-Order-Access': order.accessToken };
  assert.equal((await fetch(base + 'orders/' + order.id)).status, 403);
  assert.equal((await fetch(base + 'orders/' + order.id, { headers: privateHeaders })).status, 200);
  assert.equal((await post(`orders/${order.id}/payments`, { channel: 'wechat' }, privateHeaders)).status, 503);
  assert.equal((await post(`admin/orders/${order.id}/check-external`, { accepted: true, reason: 'check' })).status, 401);
  const login = await post('admin/login', { password: 'synthetic-password-only' });
  const cookie = login.headers.get('set-cookie').split(';')[0], admin = { Cookie: cookie, 'X-GetToken-Admin': '1' };
  assert.equal((await post(`admin/orders/${order.id}/check-external`, { accepted: true, reason: 'check' }, { Cookie: cookie })).status, 403);
  assert.equal((await post(`admin/orders/${order.id}/check-external`, { accepted: true, reason: 'Synthetic check' }, admin)).status, 200);
  const result = await post(`admin/orders/${order.id}/decision`, { result: 'failed', reason: 'Synthetic result' }, admin);
  assert.equal(result.status, 200); assert.equal((await result.json()).refundStatus, 'pending');
  assert.equal((await post(`admin/orders/${order.id}/external-refund`, { reason: 'Synthetic refund check' }, admin)).status, 200);
  const view = await (await fetch(base + 'orders/' + order.id, { headers: privateHeaders })).json();
  assert.equal(view.refund.status, 'success'); assert.equal(view.accessToken, undefined);
  assert.ok(!JSON.stringify(view).includes(CODE)); assert.ok(!JSON.stringify(view).includes(REFERENCE));
});
