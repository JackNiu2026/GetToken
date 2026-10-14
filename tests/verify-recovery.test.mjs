import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { openStore } from '../server/verify/store.mjs';
import { createService } from '../server/verify/service.mjs';
import { createApp } from '../server/verify/app.mjs';
import { mockProvider } from '../server/verify/pay/mock.mjs';
import { VERIFY } from '../assets/gettoken/verify-rules.mjs';

const CODE = 'sk-recovery-' + 'x'.repeat(45);
const MINUTE = 60000;
function setup(t, providers, mode = 'mock') {
  let time = Date.UTC(2026, 9, 14, 2);
  const store = openStore(':memory:');
  t.after(() => store.close());
  const config = { secret: randomBytes(32), mode };
  const service = createService({ store, config, providers, now: () => time });
  return { store, service, config, add: ms => { time += ms; }, now: () => time };
}
const create = (service, channel) => service.createOrder({ code: CODE, agree: true, channel });

function paymentPlatform() {
  const trades = new Map();
  const queried = [];
  const refunds = [];
  let available = true;
  const provider = channel => ({
    name: channel, label: channel,
    async precreate({ outTradeNo, amountMinor }) {
      if (!trades.has(outTradeNo)) trades.set(outTradeNo, { amount: amountMinor, paid: false, closed: false });
      return { qr: `TEST:${outTradeNo}` };
    },
    async query(id) {
      queried.push(id);
      if (!available) throw new Error('simulated outage');
      const trade = trades.get(id);
      return trade?.paid ? { paid: true, tradeNo: `T-${id}`, amountMinor: trade.amount }
        : { paid: false, closed: !!trade?.closed };
    },
    async close(id) {
      if (!available) throw new Error('simulated outage');
      const trade = trades.get(id);
      if (trade?.paid) throw new Error('already paid');
      if (trade) trade.closed = true;
      return { closed: true };
    },
    async refund(input) { refunds.push(input); return { status: 'success' }; },
    async refundQuery() { return { status: 'success' }; },
  });
  return { trades, queried, refunds, provider, setAvailable: value => { available = value; } };
}

test('a second paid QR is reconciled and refunded when its notification is lost', async t => {
  const platform = paymentPlatform();
  const { store, service, add } = setup(t, { a: platform.provider('a'), b: platform.provider('b') });
  const order = await create(service, 'a');
  const second = (await service.requestPayment(order.id, 'b')).payment;
  platform.trades.get(order.payment.id).paid = true;
  service.markPaid(order.payment.id, { amountMinor: order.payment.amount, tradeNo: 'A' });
  platform.trades.get(second.id).paid = true;
  add(MINUTE + 1);
  await service.tick();
  assert.ok(platform.queried.includes(second.id));
  assert.equal(store.get('select status from payments where id = ?', second.id).status, 'duplicate');
  assert.equal(platform.refunds.length, 1);
  assert.equal(platform.refunds[0].amountMinor, 33000);
  await service.tick();
  assert.equal(platform.refunds.length, 1, 'no second refund after reconciliation');
});

test('paid orders survive missing notifications and a long provider outage', async t => {
  const platform = paymentPlatform();
  const { service, add } = setup(t, { a: platform.provider('a') });
  const order = await create(service, 'a');
  platform.trades.get(order.payment.id).paid = true;
  platform.setAvailable(false);
  add(46 * MINUTE);
  await service.tick();
  platform.setAvailable(true);
  add(MINUTE + 1);
  await service.tick();
  assert.equal((await service.lookup(order.id)).status, 'reviewing');
});

test('a legacy locally closed payment is checked again after upgrading', async t => {
  const platform = paymentPlatform();
  const { store, service, add } = setup(t, { a: platform.provider('a') });
  const order = await create(service, 'a');
  store.run("update payments set status = 'closed' where id = ?", order.payment.id);
  platform.trades.get(order.payment.id).paid = true;
  add(2 * MINUTE);
  await service.tick();
  assert.equal((await service.lookup(order.id)).status, 'reviewing');
});

test('a failed remote close does not stop reconciliation and paid-on-close races recover', async t => {
  const platform = paymentPlatform();
  const provider = platform.provider('a');
  provider.close = async id => { platform.trades.get(id).paid = true; throw new Error('paid while closing'); };
  const { service, add } = setup(t, { a: provider });
  const order = await create(service, 'a');
  add(16 * MINUTE);
  await service.tick();
  add(MINUTE + 1);
  await service.tick();
  assert.equal((await service.lookup(order.id)).status, 'reviewing');
});

test('an expired QR is closed only after the platform confirms it and stops being queried', async t => {
  const platform = paymentPlatform();
  const { store, service, add } = setup(t, { a: platform.provider('a') });
  const order = await create(service, 'a');
  add(16 * MINUTE);
  await service.tick();
  assert.equal(store.get('select status from payments where id = ?', order.payment.id).status, 'closed');
  const count = platform.queried.length;
  add(60 * MINUTE);
  await service.tick();
  assert.equal(platform.queried.length, count);
});

test('concurrent renewals share one remote QR creation', async t => {
  const calls = [];
  const provider = { ...mockProvider(), precreate: async ({ outTradeNo }) => {
    calls.push(outTradeNo);
    await new Promise(r => setTimeout(r, 15));
    return { qr: `TEST:${outTradeNo}` };
  } };
  const { service, add } = setup(t, { mock: provider });
  const order = await create(service, 'mock');
  add(16 * MINUTE);
  calls.length = 0;
  const views = await Promise.all(Array.from({ length: 5 }, () => service.requestPayment(order.id, 'mock')));
  assert.equal(calls.length, 1);
  assert.equal(new Set(views.map(o => o.payment.id)).size, 1);
});

test('different channels reserve different trade numbers before remote requests finish', async t => {
  const calls = [];
  const p = name => ({ ...mockProvider(), name, precreate: async ({ outTradeNo }) => {
    calls.push({ name, outTradeNo });
    await new Promise(r => setTimeout(r, 15));
    return { qr: `TEST:${outTradeNo}` };
  } });
  const { service, add } = setup(t, { a: p('a'), b: p('b') });
  const order = await create(service, 'a');
  add(16 * MINUTE);
  calls.length = 0;
  await Promise.all([service.requestPayment(order.id, 'a'), service.requestPayment(order.id, 'b')]);
  assert.equal(new Set(calls.map(c => c.outTradeNo)).size, 2);
});

test('a timed-out precreate keeps the same reservation for a safe retry', async t => {
  let fail = false;
  const calls = [];
  const p = { ...mockProvider(), precreate: async ({ outTradeNo }) => {
    calls.push(outTradeNo);
    if (fail) throw new Error('remote response lost');
    return { qr: `TEST:${outTradeNo}` };
  } };
  const { service, add } = setup(t, { mock: p });
  const order = await create(service, 'mock');
  add(16 * MINUTE);
  fail = true;
  await assert.rejects(service.requestPayment(order.id, 'mock'), /获取失败/);
  assert.equal((await service.lookup(order.id)).payment, null, 'a reserved row without a QR must not reach the page');
  fail = false;
  await service.requestPayment(order.id, 'mock');
  assert.equal(calls.at(-1), calls.at(-2));
});

test('a verified notification during precreate can match the already reserved payment', async t => {
  let service;
  const p = { ...mockProvider(), precreate: async ({ outTradeNo, amountMinor }) => {
    service.markPaid(outTradeNo, { amountMinor, tradeNo: 'FAST-NOTIFY' });
    return { qr: `TEST:${outTradeNo}` };
  } };
  ({ service } = setup(t, { mock: p }));
  const order = await create(service, 'mock');
  assert.equal(order.status, 'reviewing');
});

test('live opening is enforced by the API while existing orders remain available', async t => {
  assert.equal(VERIFY.open, false, 'this release is advertised as coming soon');
  const platform = paymentPlatform();
  const fixture = setup(t, { a: platform.provider('a') });
  const existing = await create(fixture.service, 'a');
  fixture.config.mode = 'live';
  const app = createApp({ ...fixture, providers: { a: platform.provider('a') } });
  const server = createServer(app);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise(r => server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}/api/verify/`;
  const config = await fetch(base + 'config').then(r => r.json());
  assert.deepEqual(config.channels, []);
  const response = await fetch(base + 'orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: CODE, agree: true, channel: 'a' }) });
  assert.equal(response.status, 503);
  assert.equal((await fetch(base + 'orders/' + existing.id)).status, 200);
  fixture.add(16 * MINUTE);
  const renew = await fetch(base + `orders/${existing.id}/payments`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channel: 'a' }) });
  assert.equal(renew.status, 200, 'closing new submissions does not abandon existing orders');
});

test('recovery continues after the unpaid order expires at twenty-four hours', async t => {
  const platform = paymentPlatform();
  const { service, add } = setup(t, { a: platform.provider('a') });
  const order = await create(service, 'a');
  platform.trades.get(order.payment.id).paid = true;
  platform.setAvailable(false);
  add(25 * 60 * MINUTE);
  await service.tick();
  assert.equal((await service.lookup(order.id)).status, 'expired');
  platform.setAvailable(true);
  add(60 * MINUTE + 1);
  await service.tick();
  assert.equal((await service.lookup(order.id)).status, 'reviewing');
});

test('payments confirmed after their expired code is purged are returned in full', async t => {
  const platform = paymentPlatform();
  const { service, add } = setup(t, { a: platform.provider('a') });
  const order = await create(service, 'a');
  platform.trades.get(order.payment.id).paid = true;
  platform.setAvailable(false);
  add(8 * 24 * 60 * MINUTE);
  await service.tick();
  assert.equal(service.adminDetail(order.id).code, null);
  platform.setAvailable(true);
  add(60 * MINUTE + 1);
  await service.tick();
  assert.equal(platform.refunds.length, 1);
  assert.equal(platform.refunds[0].amountMinor, 33000);
  assert.notEqual((await service.lookup(order.id)).status, 'reviewing');
});
