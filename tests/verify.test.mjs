import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { generateKeyPairSync, createSign, createVerify, createCipheriv, randomBytes } from 'node:crypto';
import { VERIFY, codeProblem, normalizeCode, totalMinor } from '../assets/gettoken/verify-rules.mjs';
import { qrMatrix, qrSvg } from '../assets/gettoken/qr.mjs';
import { openStore } from '../server/verify/store.mjs';
import { createService } from '../server/verify/service.mjs';
import { createApp } from '../server/verify/app.mjs';
import { mockProvider } from '../server/verify/pay/mock.mjs';
import { alipayProvider, requestSignContent, notifySignContent, rawNode } from '../server/verify/pay/alipay.mjs';
import { wechatProvider } from '../server/verify/pay/wechat.mjs';
import { yuanToMinor, minorToYuan } from '../server/verify/pay/keys.mjs';
import { hashPassword, checkPassword, sealCode, openCode } from '../server/verify/secure.mjs';

const CODE = `sk-proj-${'a1B2c3D4e5'.repeat(5)}`;
const HOUR = 3600_000;

function setup({ start = Date.UTC(2026, 9, 14, 2), providers = { mock: mockProvider() } } = {}) {
  let now = start;
  const store = openStore(':memory:');
  const config = { secret: randomBytes(32), mode: 'mock' };
  const service = createService({ store, config, providers, now: () => now });
  return { store, service, config, clock: { get: () => now, add: ms => { now += ms; } } };
}
const payFirst = (store, service, id) => {
  const payment = store.get("select * from payments where order_id = ? and status = 'pending'", id);
  return service.markPaid(payment.id, { tradeNo: 'T1', amountMinor: payment.amount });
};

test('codes must start with sk and look complete', () => {
  assert.equal(codeProblem(CODE), null);
  assert.equal(normalizeCode(` ${CODE.slice(0, 20)}\n${CODE.slice(20)} `), CODE);
  assert.match(codeProblem('pk-' + CODE.slice(3)), /sk 开头/);
  assert.match(codeProblem('sk-short'), /太短/);
  assert.match(codeProblem(`sk-${'x'.repeat(VERIFY.codeMax)}`), /太长/);
  assert.match(codeProblem(`${CODE}!`), /只能包含/);
  assert.equal(totalMinor(), 33000);
});

test('QR encoder picks the smallest version and draws finder patterns', () => {
  assert.equal(qrMatrix('a').length, 21);
  assert.equal(qrMatrix('weixin://wxpay/bizpayurl?pr=AbCdEf123').length, 29);
  const m = qrMatrix('https://qr.alipay.com/bax08431fvqpkxp1lzkd0055');
  for (const [x, y] of [[0, 0], [m.length - 7, 0], [0, m.length - 7]]) {
    assert.ok(m[y][x] && m[y + 6][x + 6] && !m[y + 1][x + 1] && m[y + 3][x + 3], 'finder pattern');
  }
  assert.match(qrSvg('x'), /^<svg[^>]+viewBox="0 0 29 29"/);
});

test('codes are encrypted at rest and the admin password is hashed', () => {
  const key = randomBytes(32);
  const sealed = sealCode(key, CODE);
  assert.ok(!sealed.includes(CODE.slice(5, 20)));
  assert.equal(openCode(key, sealed), CODE);
  assert.throws(() => openCode(randomBytes(32), sealed));
  const hash = hashPassword('correct horse battery');
  assert.ok(checkPassword('correct horse battery', hash));
  assert.ok(!checkPassword('wrong', hash));
});

test('an order is reviewed only after payment and only the admin records the result', async () => {
  const { store, service, clock } = setup();
  const order = await service.createOrder({ code: CODE, agree: true, showPublic: true, channel: 'mock' });
  assert.equal(order.status, 'unpaid');
  assert.equal(order.code, `sk••••${CODE.slice(-4)}`);
  assert.equal(order.payment.amount, 33000);
  assert.throws(() => service.decide(order.id, 'passed'), /还没有付款/);
  await assert.rejects(service.createOrder({ code: CODE, agree: false, channel: 'mock' }), /退款规则/);
  payFirst(store, service, order.id);
  let view = await service.lookup(order.id);
  assert.equal(view.status, 'reviewing');
  assert.equal(view.dueAt - view.paidAt, VERIFY.reviewHours * HOUR);
  clock.add(30 * HOUR);
  await service.tick();
  assert.equal((await service.lookup(order.id)).status, 'reviewing', 'The countdown never decides');
  service.decide(order.id, 'passed');
  view = await service.lookup(order.id);
  assert.equal(view.status, 'passed');
  assert.throws(() => service.decide(order.id, 'failed'), /已经有结果/);
  const feed = service.feed();
  assert.equal(feed.items[0].code, `sk••••${CODE.slice(-4)}`);
  assert.equal(feed.today.passed, 1);
});

test('a failed review refunds only the audit fee, and private orders stay off the feed', async () => {
  const { store, service } = setup();
  const order = await service.createOrder({ code: CODE, agree: true, showPublic: false, channel: 'mock' });
  payFirst(store, service, order.id);
  service.decide(order.id, 'failed', '代码已失效');
  const refund = store.get("select * from refunds where order_id = ? and kind = 'audit'", order.id);
  assert.equal(refund.amount, VERIFY.auditFeeMinor);
  await service.runRefund(refund);
  const view = await service.lookup(order.id);
  assert.equal(view.reason, '代码已失效');
  assert.equal(view.refund.status, 'success');
  assert.equal(view.refund.dueAt - view.decidedAt, VERIFY.refundHours * HOUR);
  assert.equal(service.feed().items.length, 0);
  assert.equal(service.feed().today.processed, 1);
});

test('a second payment for the same order is refunded in full; wrong amounts are rejected', async () => {
  const { store, service } = setup();
  const order = await service.createOrder({ code: CODE, agree: true, channel: 'mock' });
  const first = store.get('select * from payments where order_id = ?', order.id);
  assert.throws(() => service.markPaid(first.id, { amountMinor: 100 }), /Amount mismatch/);
  service.markPaid(first.id, { tradeNo: 'A', amountMinor: first.amount });
  store.run("insert into payments(id, order_id, channel, status, amount, created_at, expires_at) values('X2', ?, 'mock', 'pending', 33000, 0, 0)", order.id);
  service.markPaid('X2', { tradeNo: 'B', amountMinor: 33000 });
  const duplicate = store.get("select * from refunds where kind = 'duplicate'");
  assert.equal(duplicate.amount, 33000);
  assert.equal(service.markPaid(first.id, { tradeNo: 'A', amountMinor: first.amount }).status, 'paid', 'Notifications are idempotent');
});

test('background work expires unpaid orders and deletes settled codes', async () => {
  const { store, service, clock } = setup();
  const unpaid = await service.createOrder({ code: CODE, agree: true, channel: 'mock' });
  const done = await service.createOrder({ code: `${CODE}Z`, agree: true, channel: 'mock' });
  payFirst(store, service, done.id);
  service.decide(done.id, 'passed');
  clock.add(25 * HOUR);
  await service.tick();
  assert.equal((await service.lookup(unpaid.id)).status, 'expired');
  clock.add(7 * 24 * HOUR);
  await service.tick();
  const detail = service.adminDetail(done.id);
  assert.equal(detail.code, null);
  assert.ok(detail.codePurged);
});

// Alipay: one key pair stands in for the app, another for the platform.
function alipayFixture() {
  const app = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const platform = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = key => key.export({ type: key.type === 'private' ? 'pkcs8' : 'spki', format: 'pem' });
  const state = { trades: new Map(), refunds: [] };
  const sign = text => createSign('RSA-SHA256').update(text).sign(platform.privateKey, 'base64');
  const fetch = async (url, { body }) => {
    const params = Object.fromEntries(new URLSearchParams(body));
    // Built by hand from the spec: every non-empty parameter except sign, sign_type included, sorted.
    const expected = Object.keys(params).filter(k => k !== 'sign' && params[k] !== '').sort().map(k => `${k}=${params[k]}`).join('&');
    assert.match(expected, /&sign_type=RSA2&/);
    assert.ok(createVerify('RSA-SHA256').update(expected).verify(app.publicKey, params.sign, 'base64'), 'request signed with app key');
    const biz = JSON.parse(params.biz_content);
    let node;
    if (params.method === 'alipay.trade.precreate') {
      state.trades.set(biz.out_trade_no, { amount: biz.total_amount, status: 'WAIT_BUYER_PAY' });
      state.notifyUrl = params.notify_url;
      node = { code: '10000', msg: 'Success', out_trade_no: biz.out_trade_no, qr_code: 'https://qr.alipay.com/bax0test' };
    } else if (params.method === 'alipay.trade.query') {
      const trade = state.trades.get(biz.out_trade_no);
      node = trade ? { code: '10000', out_trade_no: biz.out_trade_no, trade_status: trade.status, total_amount: trade.amount, trade_no: '2026TRADE' } : { code: '40004', sub_code: 'ACQ.TRADE_NOT_EXIST' };
    } else if (params.method === 'alipay.trade.close') {
      state.trades.get(biz.out_trade_no).status = 'TRADE_CLOSED';
      node = { code: '10000', out_trade_no: biz.out_trade_no };
    } else if (params.method === 'alipay.trade.refund') {
      state.refunds.push(biz);
      node = { code: '10000', out_trade_no: biz.out_trade_no, refund_fee: biz.refund_amount, fund_change: state.refunds.length === 1 ? 'Y' : 'N' };
    } else if (params.method === 'alipay.trade.fastpay.refund.query') {
      node = { code: '10000', out_trade_no: biz.out_trade_no, out_request_no: biz.out_request_no, refund_amount: '300.00', refund_status: 'REFUND_SUCCESS' };
    }
    const key = `${params.method.replaceAll('.', '_')}_response`;
    const raw = JSON.stringify(node);
    const forged = state.forge ? raw.replace('WAIT_BUYER_PAY', 'TRADE_SUCCESS') : raw;
    return new Response(`{"${key}":${forged},"sign":"${sign(raw)}"}`);
  };
  const provider = alipayProvider({ appId: '2021000000000001', gateway: 'https://example.invalid/gateway.do', privateKey: pem(app.privateKey), publicKey: pem(platform.publicKey) }, { fetch, notifyUrl: 'https://gettoken.cc/api/verify/notify/alipay' });
  return { provider, state, sign };
}

test('Alipay requests are signed, responses verified and notifications checked', async () => {
  const { provider, state, sign } = alipayFixture();
  assert.equal((await provider.precreate({ outTradeNo: 'GTVF1014AAAAAAP1', amountMinor: 33000, subject: 's', expiresAt: Date.now() + 900_000 })).qr, 'https://qr.alipay.com/bax0test');
  assert.equal(state.trades.get('GTVF1014AAAAAAP1').amount, '330.00');
  assert.deepEqual(await provider.query('missing'), { paid: false });
  assert.equal((await provider.query('GTVF1014AAAAAAP1')).paid, false);
  state.forge = true;
  await assert.rejects(provider.query('GTVF1014AAAAAAP1'), /signature invalid/);
  state.forge = false;
  state.trades.get('GTVF1014AAAAAAP1').status = 'TRADE_SUCCESS';
  assert.deepEqual(await provider.query('GTVF1014AAAAAAP1'), { paid: true, tradeNo: '2026TRADE', amountMinor: 33000 });
  assert.deepEqual(await provider.refund({ outTradeNo: 'GTVF1014AAAAAAP1', refundId: 'GTVF1014AAAAAAR1', amountMinor: 30000, reason: 'r' }), { status: 'success' });
  assert.equal(state.refunds[0].refund_amount, '300.00');
  assert.deepEqual(await provider.refund({ outTradeNo: 'GTVF1014AAAAAAP1', refundId: 'GTVF1014AAAAAAR1', amountMinor: 30000, reason: 'r' }), { status: 'processing' }, 'fund_change=N is confirmed by a query');
  assert.deepEqual(await provider.refundQuery({ outTradeNo: 'GTVF1014AAAAAAP1', refundId: 'GTVF1014AAAAAAR1' }), { status: 'success' });

  const notify = { app_id: '2021000000000001', out_trade_no: 'GTVF1014AAAAAAP1', trade_no: '2026TRADE', trade_status: 'TRADE_SUCCESS', total_amount: '330.00', sign_type: 'RSA2' };
  notify.sign = sign(notifySignContent(notify));
  assert.ok(!notifySignContent(notify).includes('sign_type'), 'notifications are verified without sign_type');
  assert.deepEqual(provider.parseNotify(new URLSearchParams(notify).toString()), { outTradeNo: 'GTVF1014AAAAAAP1', tradeNo: '2026TRADE', amountMinor: 33000 });
  assert.throws(() => provider.parseNotify(new URLSearchParams({ ...notify, total_amount: '0.01' }).toString()), /signature invalid/);
  assert.equal(rawNode('{"a_response":{"x":"}{\\"","y":{"z":1}},"sign":"s"}', 'a_response'), '{"x":"}{\\"","y":{"z":1}}');
  assert.equal(yuanToMinor('330.5'), 33050);
  assert.equal(minorToYuan(5), '0.05');
});

// WeChat Pay: merchant key signs requests; the WeChat Pay public key signs responses and callbacks.
function wechatFixture() {
  const merchant = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const platform = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = key => key.export({ type: key.type === 'private' ? 'pkcs8' : 'spki', format: 'pem' });
  const apiV3Key = 'k'.repeat(32);
  const config = { mchid: '1900000001', appid: 'wx0000000000000001', serialNo: 'SERIAL', apiV3Key, privateKey: pem(merchant.privateKey), platformKey: pem(platform.publicKey), platformKeyId: 'PUB_KEY_ID_0001', base: 'https://example.invalid' };
  const signed = (body, { serial = 'PUB_KEY_ID_0001', timestamp = String(Math.floor(Date.now() / 1000)) } = {}) => {
    const nonce = randomBytes(8).toString('hex');
    const signature = createSign('RSA-SHA256').update(`${timestamp}\n${nonce}\n${body}\n`).sign(platform.privateKey, 'base64');
    return { 'wechatpay-serial': serial, 'wechatpay-timestamp': timestamp, 'wechatpay-nonce': nonce, 'wechatpay-signature': signature };
  };
  const state = {};
  const fetch = async (url, { method, headers, body = '' }) => {
    const path = url.replace(config.base, '');
    const auth = /signature="([^"]+)",timestamp="(\d+)"/.exec(headers.Authorization);
    const nonce = /nonce_str="([^"]+)"/.exec(headers.Authorization)[1];
    assert.ok(createVerify('RSA-SHA256').update(`${method}\n${path}\n${auth[2]}\n${nonce}\n${body}\n`).verify(merchant.publicKey, auth[1], 'base64'), 'request signed with merchant key');
    let status = 200;
    let data;
    if (path === '/v3/pay/transactions/native') { state.native = JSON.parse(body); data = { code_url: 'weixin://wxpay/bizpayurl?pr=test' }; }
    else if (method === 'POST' && path.endsWith('/close')) { state.close = JSON.parse(body); state.closed = true; status = 204; data = null; }
    else if (path.startsWith('/v3/pay/transactions/out-trade-no/')) { data = { mchid: config.mchid, appid: config.appid, out_trade_no: path.split('/').at(-1).split('?')[0], trade_state: state.closed ? 'CLOSED' : state.tradeState || 'SUCCESS', transaction_id: '4200TX', amount: { total: 33000 } }; }
    else if (path === '/v3/refund/domestic/refunds') { state.refund = JSON.parse(body); data = { status: 'PROCESSING', out_trade_no: state.refund.out_trade_no, out_refund_no: state.refund.out_refund_no, amount: state.refund.amount }; }
    else { status = 404; data = { code: 'RESOURCE_NOT_EXISTS', message: '不存在' }; }
    const text = status === 204 ? '' : JSON.stringify(data);
    return new Response(status === 204 ? null : text, { status, headers: status === 204 ? {} : state.badSignature ? signed(text, { serial: 'OTHER' }) : signed(text) });
  };
  const encrypt = plain => {
    const nonce = 'abcdefghijkl';
    const cipher = createCipheriv('aes-256-gcm', Buffer.from(apiV3Key), Buffer.from(nonce));
    cipher.setAAD(Buffer.from('transaction'));
    const out = Buffer.concat([cipher.update(JSON.stringify(plain)), cipher.final(), cipher.getAuthTag()]);
    return { algorithm: 'AEAD_AES_256_GCM', ciphertext: out.toString('base64'), nonce, associated_data: 'transaction' };
  };
  return { provider: wechatProvider(config, { fetch, notifyUrl: 'https://gettoken.cc/api/verify/notify/wechat' }), state, signed, encrypt, config };
}

test('WeChat Pay requests are signed, responses and callbacks verified and decrypted', async () => {
  const { provider, state, signed, encrypt, config } = wechatFixture();
  assert.equal((await provider.precreate({ outTradeNo: 'GTVF1014BBBBBBP1', amountMinor: 33000, subject: 'GetToken', expiresAt: Date.UTC(2026, 9, 14, 4) })).qr, 'weixin://wxpay/bizpayurl?pr=test');
  assert.equal(state.native.amount.total, 33000);
  assert.equal(state.native.time_expire, '2026-10-14T12:00:00+08:00');
  assert.deepEqual(await provider.query('GTVF1014BBBBBBP1'), { paid: true, tradeNo: '4200TX', amountMinor: 33000 });
  assert.deepEqual(await provider.refund({ outTradeNo: 'GTVF1014BBBBBBP1', refundId: 'R1', amountMinor: 30000, totalMinor: 33000, reason: 'r' }), { status: 'processing' });
  assert.deepEqual(state.refund.amount, { refund: 30000, total: 33000, currency: 'CNY' });
  assert.equal((await provider.refundQuery({ refundId: 'missing' })).status, 'not_found');
  state.badSignature = true;
  await assert.rejects(provider.query('GTVF1014BBBBBBP1'), /unknown signing key/);

  const tx = { mchid: config.mchid, appid: config.appid, out_trade_no: 'GTVF1014BBBBBBP1', transaction_id: '4200TX', trade_state: 'SUCCESS', amount: { total: 33000 } };
  const body = JSON.stringify({ event_type: 'TRANSACTION.SUCCESS', resource: encrypt(tx) });
  assert.deepEqual(provider.parseNotify(body, signed(body)), { outTradeNo: 'GTVF1014BBBBBBP1', tradeNo: '4200TX', amountMinor: 33000 });
  assert.throws(() => provider.parseNotify(body.replace('SUCCESS', 'SUCCESX'), signed(body)), /signature invalid/);
  assert.throws(() => provider.parseNotify(body, signed(body, { timestamp: '1000' })), /stale/);
  const other = JSON.stringify({ event_type: 'TRANSACTION.SUCCESS', resource: encrypt({ ...tx, mchid: '1' }) });
  assert.throws(() => provider.parseNotify(other, signed(other)), /wrong merchant/);
});

test('the HTTP API guards the admin endpoints and validates input', async () => {
  const { store, service, config } = setup({ start: Date.now() });
  store.setSetting('admin_password', hashPassword('correct horse battery'));
  const providers = { mock: mockProvider() };
  const server = createServer(createApp({ service, store, providers, config }));
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${server.address().port}/api/verify`;
  const call = (path, { method = 'GET', body, headers = {} } = {}) => fetch(base + path, { method, body: body && JSON.stringify(body), headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers } });
  try {
    assert.equal((await call('/config').then(r => r.json())).fees.audit, 30000);
    assert.equal((await call('/orders/../../etc')).status, 404);
    assert.equal((await call('/orders/GT-VF-1014-BAD')).status, 400);
    assert.equal((await call('/orders', { method: 'POST', body: { code: CODE, agree: true, channel: 'mock' }, headers: { 'Content-Type': 'text/plain' } })).status, 415);
    const created = await call('/orders', { method: 'POST', body: { code: CODE, agree: true, showPublic: true, channel: 'mock' } });
    assert.equal(created.status, 201);
    const order = await created.json();
    assert.equal((await call(`/orders/${order.id.toLowerCase()}`, { headers: { 'X-GetToken-Order-Access': order.accessToken } }).then(r => r.json())).status, 'unpaid');

    assert.equal((await call('/admin/orders')).status, 401);
    assert.equal((await call('/admin/login', { method: 'POST', body: { password: 'nope' } })).status, 401);
    assert.equal((await call('/admin/login', { method: 'POST', body: { password: 'correct horse battery' }, headers: { 'X-Forwarded-Proto': 'http' } })).status, 403, 'No admin login over plain HTTP');
    const login = await call('/admin/login', { method: 'POST', body: { password: 'correct horse battery' } });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie');
    assert.match(cookie, /HttpOnly; Secure; SameSite=Strict/);
    const session = { Cookie: cookie.split(';')[0] };
    assert.equal((await call('/admin/orders', { headers: session }).then(r => r.json())).total, 1);
    const detail = await call(`/admin/orders/${order.id}`, { headers: session }).then(r => r.json());
    assert.equal(detail.code, CODE);
    assert.equal((await call(`/admin/orders/${order.id}/mock-pay`, { method: 'POST', body: {}, headers: session })).status, 403, 'Needs the admin header');
    const paid = await call(`/admin/orders/${order.id}/mock-pay`, { method: 'POST', body: {}, headers: { ...session, 'X-GetToken-Admin': '1' } });
    assert.equal((await paid.json()).status, 'reviewing');
    const decided = await call(`/admin/orders/${order.id}/decision`, { method: 'POST', body: { result: 'failed', reason: '不符合' }, headers: { ...session, 'X-GetToken-Admin': '1' } }).then(r => r.json());
    assert.equal(decided.status, 'failed');
    assert.equal(decided.refunds[0].status, 'success');
    await call('/admin/logout', { method: 'POST', body: {}, headers: session });
    assert.equal((await call('/admin/orders', { headers: session })).status, 401);
    const bad = await call('/notify/alipay', { method: 'POST', body: {} });
    assert.equal(bad.status, 404, 'Unconfigured channels ignore notifications');
  } finally {
    server.close();
  }
});

test('refund status checks keep retrying, failed requests back off without a cap', async () => {
  let mode = 'processing';
  const provider = {
    ...mockProvider(),
    async refund() { if (mode === 'down') throw new Error('network'); return { status: 'processing' }; },
    async refundQuery() { if (mode === 'down') throw new Error('network'); return { status: mode }; },
  };
  const { store, service, clock } = setup({ providers: { mock: provider } });
  const order = await service.createOrder({ code: CODE, agree: true, channel: 'mock' });
  payFirst(store, service, order.id);
  service.decide(order.id, 'failed');
  const read = () => store.get("select * from refunds where kind = 'audit'");
  for (let i = 0; i < 5; i += 1) { clock.add(60_000); await service.tick(); }
  assert.equal(read().status, 'processing');
  assert.equal(read().attempts, 0, 'Status checks are not failed attempts');
  mode = 'down';
  clock.add(60_000);
  await service.tick();
  assert.equal(read().status, 'processing', 'A failed status check keeps the refund in processing');
  mode = 'success';
  clock.add(60_000);
  await service.tick();
  assert.equal((await service.lookup(order.id)).refund.status, 'success');
  assert.equal(service.stats().refundOverdue, 0);
});

test('a refund that keeps failing is retried later and shows as overdue after 24 hours', async () => {
  let calls = 0;
  const provider = { ...mockProvider(), async refund() { calls += 1; return { status: 'error', error: '余额不足' }; } };
  const { store, service, clock } = setup({ providers: { mock: provider } });
  const order = await service.createOrder({ code: CODE, agree: true, channel: 'mock' });
  payFirst(store, service, order.id);
  service.decide(order.id, 'failed');
  for (let i = 0; i < 26 * 6; i += 1) { clock.add(10 * 60_000); await service.tick(); }
  assert.ok(calls > 20, `retried ${calls} times over 26 hours`);
  assert.equal(service.stats().refundOverdue, 1);
  const detail = service.adminDetail(order.id);
  assert.equal(detail.refunds[0].error, '余额不足');
});

test('an amount mismatch is logged for the admin and never marks the order paid', async () => {
  const { store, service } = setup();
  const order = await service.createOrder({ code: CODE, agree: true, channel: 'mock' });
  const payment = store.get('select * from payments where order_id = ?', order.id);
  assert.throws(() => service.markPaid(payment.id, { amountMinor: 1 }), /Amount mismatch/);
  assert.equal((await service.lookup(order.id)).status, 'unpaid');
  assert.ok(service.adminDetail(order.id).events.some(e => e.kind === 'payment_amount_mismatch'));
});

test('Alipay closes expired trades with a signed request and verified response', async () => {
  const { provider, state } = alipayFixture();
  const id = 'GTVF1014CLOSE1';
  await provider.precreate({ outTradeNo: id, amountMinor: 33000, subject: 'test', expiresAt: Date.now() + 900000 });
  assert.deepEqual(await provider.close(id), { closed: true });
  assert.equal(state.trades.get(id).status, 'TRADE_CLOSED');
  assert.deepEqual(await provider.query(id), { paid: false, closed: true });
});

test('WeChat empty close responses require a signed terminal query before settlement', async () => {
  const { provider, state } = wechatFixture();
  assert.deepEqual(await provider.close('GTVF1014CLOSE2'), { closed: true });
  assert.equal(state.close.mchid, '1900000001');
  state.badSignature = true;
  await assert.rejects(provider.close('GTVF1014CLOSE2'), /unknown signing key/);
  state.badSignature = false;
  state.closed = false;
  state.tradeState = 'PAYERROR';
  const retryable = await provider.query('GTVF1014CLOSE3');
  assert.equal(retryable.paid, false);
  assert.notEqual(retryable.closed, true, 'a payment error is not a confirmed closed trade');
});
