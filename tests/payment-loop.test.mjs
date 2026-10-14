import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { openStore } from '../server/verify/store.mjs';
import { createService } from '../server/verify/service.mjs';
import { createApp } from '../server/verify/app.mjs';
import { createProviders } from '../server/verify/pay/index.mjs';
import { hashPassword } from '../server/verify/secure.mjs';
import { mockProvider } from '../server/verify/pay/mock.mjs';
import { paymentPlatform } from './helpers/payment-platform.mjs';

const CODE = 'sk-acceptance-' + 'aB12'.repeat(12);
async function setup(t) {
  const platform = await paymentPlatform(t);
  const config = { mode: 'live', acceptNewOrders: true, origin: 'https://gettoken.cc', secret: randomBytes(32), alipay: platform.alipay, wechat: platform.wechat };
  const providers = createProviders(config, { fetch: platform.transport });
  const store = openStore(':memory:'); t.after(() => store.close());
  const service = createService({ store, config, providers });
  store.setSetting('admin_password', hashPassword('payment-loop-test-only'));
  const server = createServer(createApp({ service, store, config, providers }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/verify/`;
  let cookie;
  const call = async (path, { body, admin = false, notice } = {}) => {
    const response = await fetch(base + path, {
      method: body !== undefined || notice ? 'POST' : 'GET', body: notice?.body ?? (body !== undefined ? JSON.stringify(body) : undefined),
      headers: { ...(notice?.headers || (body !== undefined ? { 'Content-Type': 'application/json' } : {})), ...(admin ? { Cookie: cookie, 'X-GetToken-Admin': '1' } : {}) },
    });
    if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    const text = await response.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: response.status, data };
  };
  assert.equal((await call('admin/login', { body: { password: 'payment-loop-test-only' } })).status, 200);
  return { platform, store, config, service, providers, call };
}

for (const channel of ['alipay', 'wechat']) {
  test(`${channel}: signed HTTP precreate, notifications, human decisions and original-route refunds`, async t => {
    const { platform, store, call } = await setup(t);
    assert.deepEqual((await call('config')).data.channels.map(c => c.key), ['alipay', 'wechat']);
    const response = await call('orders', { body: { code: CODE, agree: true, channel } });
    assert.equal(response.status, 201);
    const order = response.data, payment = order.payment.id;
    assert.equal(order.payment.amount, 33000);
    assert.equal((await call(`admin/orders/${order.id}/decision`, { body: { result: 'failed' }, admin: true })).status, 409);
    assert.equal((await call(`admin/orders/${order.id}/mock-pay`, { body: {}, admin: true })).status, 403);
    const valid = platform.paidNotice(payment);
    const forged = { ...valid, body: valid.body.replace(channel === 'alipay' ? '330.00' : 'ciphertext', channel === 'alipay' ? '0.01' : 'badcipher') };
    const rejected = await call(`notify/${channel}`, { notice: forged });
    assert.equal(channel === 'alipay' ? rejected.data : rejected.status, channel === 'alipay' ? 'fail' : 500);
    assert.equal(store.get('select status from orders where id = ?', order.id).status, 'unpaid');
    const wrongMerchant = platform.paidNotice(payment, channel === 'alipay' ? { seller_id: '2088000000000002' } : { mchid: '1900000002' });
    const rejectedMerchant = await call(`notify/${channel}`, { notice: wrongMerchant });
    assert.equal(channel === 'alipay' ? rejectedMerchant.data : rejectedMerchant.status, channel === 'alipay' ? 'fail' : 500);
    for (let i = 0; i < 2; i++) assert.equal((await call(`notify/${channel}`, { notice: valid })).status, channel === 'alipay' ? 200 : 204);
    assert.equal((await call(`orders/${order.id}`)).data.status, 'reviewing');
    assert.equal(store.get("select count(*) as n from events where order_id = ? and kind = 'paid'", order.id).n, 1);
    const decision = await call(`admin/orders/${order.id}/decision`, { body: { result: 'failed', reason: '协议验收' }, admin: true });
    assert.equal(decision.status, 200);
    const refund = decision.data.refunds[0];
    assert.equal(refund.amount, 30000);
    assert.equal(platform.state.refunds.get(refund.id).payment, payment);
    assert.equal(platform.state.transferCount, 1);
    if (channel === 'wechat') {
      const request = platform.state.requests.find(r => r.kind === 'POST /v3/refund/domestic/refunds');
      assert.equal(request.biz.notify_url, 'https://gettoken.cc/api/verify/notify/wechat/refund');
      assert.equal(refund.status, 'processing');
      const badAmount = platform.refundNotice(refund.id, { amount: { total: 33000, refund: 1 } });
      assert.equal((await call('notify/wechat/refund', { notice: badAmount })).status, 500);
      assert.equal((await call(`orders/${order.id}`)).data.refund.status, 'processing');
      const success = platform.refundNotice(refund.id);
      for (let i = 0; i < 2; i++) assert.equal((await call('notify/wechat/refund', { notice: success })).status, 204);
      assert.equal((await call('notify/wechat/refund', { notice: platform.refundNotice(refund.id, {}, 'CLOSED') })).status, 204);
    }
    const done = (await call(`orders/${order.id}`)).data;
    assert.equal(done.refund.status, 'success'); assert.ok(done.refund.refundedAt);
    assert.equal(done.fees.tech, 3000);
    assert.equal((await call(`admin/orders/${order.id}/refund`, { body: {}, admin: true })).status, 409);
    assert.equal(platform.state.transferCount, 1);
    const passed = (await call('orders', { body: { code: CODE, agree: true, channel, showPublic: true } })).data;
    await call(`notify/${channel}`, { notice: platform.paidNotice(passed.payment.id) });
    assert.equal((await call(`admin/orders/${passed.id}/decision`, { body: { result: 'passed' }, admin: true })).data.status, 'passed');
    assert.equal((await call('feed')).data.today.passed, 1);
    assert.equal(platform.state.transferCount, 1, 'passed reviews do not refund');
    for (const body of [null, [], 1]) assert.equal((await call('orders', { body })).status, 400);
  });

  test(`${channel}: a lost refund response is queried, never blindly repeated`, async t => {
    const { platform, store, service } = await setup(t);
    const order = await service.createOrder({ code: CODE, agree: true, channel });
    platform.paidNotice(order.payment.id);
    await service.lookup(order.id);
    service.decide(order.id, 'failed');
    const refund = store.get('select * from refunds where order_id = ?', order.id);
    platform.state.dropRefundResponse = true;
    await service.runRefund(refund);
    assert.equal(store.get('select status from refunds where id = ?', refund.id).status, 'processing');
    assert.equal(platform.state.transferCount, 1);
    platform.state.dropRefundResponse = false;
    platform.state.refunds.get(refund.id).status = 'SUCCESS';
    await service.runRefund(refund); // Deliberately pass the stale pending row.
    assert.equal(store.get('select status from refunds where id = ?', refund.id).status, 'success');
    assert.equal(platform.state.transferCount, 1);
    const submitted = platform.state.requests.filter(r => r.kind === (channel === 'alipay' ? 'alipay.trade.refund' : 'POST /v3/refund/domestic/refunds'));
    assert.equal(submitted.length, 1);
  });
}

test('both paid channels reconcile a lost notification and fully refund the duplicate', async t => {
  const { platform, store, service } = await setup(t);
  const order = await service.createOrder({ code: CODE, agree: true, channel: 'alipay' });
  const second = await service.requestPayment(order.id, 'wechat');
  platform.paidNotice(order.payment.id); platform.paidNotice(second.payment.id);
  await service.lookup(order.id);
  const refund = store.get("select * from refunds where kind = 'duplicate'");
  assert.equal(refund.amount, 33000);
  assert.equal(refund.channel, 'wechat');
  await service.runRefund(refund);
  platform.state.refunds.get(refund.id).status = 'SUCCESS';
  await service.runRefund(refund);
  assert.equal(store.get('select status from refunds where id = ?', refund.id).status, 'success');
  assert.equal((await service.lookup(order.id)).status, 'reviewing');
});

test('signed platform responses for the wrong order or refund amount are rejected', async t => {
  const { platform, service, providers } = await setup(t);
  for (const channel of ['alipay', 'wechat']) {
    const order = await service.createOrder({ code: CODE, agree: true, channel });
    platform.state.override = node => ({ ...node, out_trade_no: 'ANOTHER_ORDER' });
    await assert.rejects(providers[channel].query(order.payment.id), /wrong/);
    platform.state.override = node => channel === 'alipay' ? { ...node, refund_fee: '0.01' } : { ...node, amount: { ...node.amount, refund: 1 } };
    await assert.rejects(providers[channel].refund({ outTradeNo: order.payment.id, refundId: `${order.payment.id}R`, amountMinor: 30000, totalMinor: 33000, reason: 'test' }), /refund amount/);
    platform.state.override = null;
  }
});

test('concurrent refund requests coalesce and an early success callback wins over a late response', async t => {
  const store = openStore(':memory:'); t.after(() => store.close());
  let service, calls = 0;
  const provider = { ...mockProvider(), async refund(params) {
    calls++;
    await new Promise(resolve => setTimeout(resolve, 20));
    service.markRefund(params.refundId, { status: 'success', amountMinor: params.amountMinor });
    return { status: 'processing' };
  } };
  service = createService({ store, config: { mode: 'mock', secret: randomBytes(32) }, providers: { mock: provider } });
  const order = await service.createOrder({ code: CODE, agree: true, channel: 'mock' });
  service.markPaid(order.payment.id, { tradeNo: 'UNIQUE', amountMinor: 33000 }); service.decide(order.id, 'failed');
  const refund = store.get('select * from refunds where order_id = ?', order.id);
  const results = await Promise.all([service.runRefund(refund), service.runRefund(refund), service.retryRefund(order.id)]);
  assert.equal(calls, 1); assert.equal(results[0].status, 'success');
  assert.equal((await service.lookup(order.id)).refund.status, 'success');
});

test('merchant opening is controlled by the server and closing still settles existing payments', async t => {
  const { config, service, platform, call } = await setup(t);
  const order = await service.createOrder({ code: CODE, agree: true, channel: 'wechat' });
  config.acceptNewOrders = false;
  assert.deepEqual((await call('config')).data.channels, []);
  assert.equal((await call('orders', { body: { code: CODE, agree: true, channel: 'wechat' } })).status, 503);
  platform.paidNotice(order.payment.id);
  assert.equal((await service.lookup(order.id)).status, 'reviewing');
});

test('a platform trade number cannot be reused across different orders', async t => {
  const { service } = await setup(t);
  const a = await service.createOrder({ code: CODE, agree: true, channel: 'alipay' });
  const b = await service.createOrder({ code: CODE, agree: true, channel: 'alipay' });
  service.markPaid(a.payment.id, { tradeNo: 'SAME_PLATFORM_TRADE', amountMinor: 33000 });
  assert.throws(() => service.markPaid(b.payment.id, { tradeNo: 'SAME_PLATFORM_TRADE', amountMinor: 33000 }), /already used/);
  assert.throws(() => service.markPaid(a.payment.id, { tradeNo: 'DIFFERENT', amountMinor: 33000 }), /mismatch/);
});
