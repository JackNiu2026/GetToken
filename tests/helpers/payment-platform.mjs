// Independent signed HTTP fixtures for the official Alipay RSA2 / WeChat APIv3 wire formats.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { generateKeyPairSync, createSign, createVerify, createCipheriv, randomBytes } from 'node:crypto';

const pem = key => key.export({ type: key.type === 'private' ? 'pkcs8' : 'spki', format: 'pem' });
const canonical = (params, excluded) => Object.keys(params).filter(k => !excluded.includes(k) && params[k] !== '').sort().map(k => `${k}=${params[k]}`).join('&');

export async function paymentPlatform(t) {
  const app = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const merchant = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const platform = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const apiV3Key = 'v'.repeat(32), platformKeyId = 'PUB_KEY_ID_3000000001';
  const alipay = { appId: '2021000000000001', sellerId: '2088000000000001', gateway: 'https://platform.invalid/alipay', privateKey: pem(app.privateKey), publicKey: pem(platform.publicKey) };
  const wechat = { mchid: '1900000001', appid: 'wx0000000000000001', serialNo: 'ABC123', apiV3Key, platformKeyId,
    base: 'https://platform.invalid', privateKey: pem(merchant.privateKey), platformKey: pem(platform.publicKey) };
  const state = { trades: new Map(), refunds: new Map(), requests: [], override: null, transferCount: 0, dropRefundResponse: false };
  const sign = text => createSign('RSA-SHA256').update(text).sign(platform.privateKey, 'base64');
  const signedHeaders = body => {
    const timestamp = String(Math.floor(Date.now() / 1000)), nonce = randomBytes(16).toString('hex');
    return { 'wechatpay-serial': platformKeyId, 'wechatpay-timestamp': timestamp, 'wechatpay-nonce': nonce,
      'wechatpay-signature': sign(`${timestamp}\n${nonce}\n${body}\n`) };
  };
  const server = createServer(async (req, res) => {
    try {
      let body = '';
      for await (const chunk of req) body += chunk;
      let node, status = 200, kind;
      if (req.url === '/alipay') {
        const params = Object.fromEntries(new URLSearchParams(body));
        assert.equal(params.app_id, alipay.appId);
        assert.equal(params.sign_type, 'RSA2');
        assert.ok(createVerify('RSA-SHA256').update(canonical(params, ['sign'])).verify(app.publicKey, params.sign, 'base64'));
        const biz = JSON.parse(params.biz_content); kind = params.method;
        state.requests.push({ channel: 'alipay', kind, biz, notify: params.notify_url });
        const trade = state.trades.get(biz.out_trade_no);
        if (kind === 'alipay.trade.precreate') {
          if (!trade) state.trades.set(biz.out_trade_no, { amount: Math.round(Number(biz.total_amount) * 100), channel: 'alipay', paid: false });
          node = { code: '10000', out_trade_no: biz.out_trade_no, qr_code: 'https://qr.alipay.com/bax0test' };
        } else if (kind === 'alipay.trade.query') {
          node = trade ? { code: '10000', out_trade_no: biz.out_trade_no, trade_no: `ALI${biz.out_trade_no}`, total_amount: (trade.amount / 100).toFixed(2),
            trade_status: trade.paid ? 'TRADE_SUCCESS' : trade.closed ? 'TRADE_CLOSED' : 'WAIT_BUYER_PAY' } : { code: '40004', sub_code: 'ACQ.TRADE_NOT_EXIST' };
        } else if (kind === 'alipay.trade.close') {
          if (trade.paid) node = { code: '40004', sub_code: 'ACQ.TRADE_HAS_SUCCESS' };
          else { trade.closed = true; node = { code: '10000', out_trade_no: biz.out_trade_no }; }
        } else if (kind === 'alipay.trade.refund') {
          const seen = state.refunds.has(biz.out_request_no);
          if (!seen) { state.transferCount++; state.refunds.set(biz.out_request_no, { payment: biz.out_trade_no, amount: Math.round(Number(biz.refund_amount) * 100), total: trade.amount, status: 'SUCCESS' }); }
          node = { code: '10000', out_trade_no: biz.out_trade_no, trade_no: `ALI${biz.out_trade_no}`, refund_fee: biz.refund_amount, fund_change: seen ? 'N' : 'Y' };
          if (state.dropRefundResponse) { req.socket.destroy(); return; }
        } else if (kind === 'alipay.trade.fastpay.refund.query') {
          const refund = state.refunds.get(biz.out_request_no);
          node = refund ? { code: '10000', out_trade_no: refund.payment, out_request_no: biz.out_request_no, refund_amount: (refund.amount / 100).toFixed(2), refund_status: 'REFUND_SUCCESS' }
            : { code: '40004', sub_code: 'ACQ.REFUND_NOT_EXIST' };
        } else throw new Error(`Unexpected Alipay method ${kind}`);
        if (state.override) node = state.override(node, kind);
        const raw = JSON.stringify(node);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ [`${kind.replaceAll('.', '_')}_response`]: node, sign: sign(raw) }));
      } else {
        const auth = Object.fromEntries([...String(req.headers.authorization).matchAll(/(\w+)="([^"]+)"/g)].map(m => [m[1], m[2]]));
        assert.equal(auth.mchid, wechat.mchid); assert.equal(auth.serial_no, wechat.serialNo);
        assert.ok(createVerify('RSA-SHA256').update(`${req.method}\n${req.url}\n${auth.timestamp}\n${auth.nonce_str}\n${body}\n`).verify(merchant.publicKey, auth.signature, 'base64'));
        assert.equal(req.headers['wechatpay-serial'], platformKeyId);
        const biz = body ? JSON.parse(body) : {}; kind = `${req.method} ${req.url}`;
        state.requests.push({ channel: 'wechat', kind, biz });
        if (req.url === '/v3/pay/transactions/native') {
          if (!state.trades.has(biz.out_trade_no)) state.trades.set(biz.out_trade_no, { amount: biz.amount.total, channel: 'wechat', paid: false });
          node = { code_url: 'weixin://wxpay/bizpayurl?pr=test' };
        } else if (req.url.startsWith('/v3/pay/transactions/out-trade-no/')) {
          const id = req.url.split('/')[5].split('?')[0], trade = state.trades.get(id);
          if (!trade) { status = 404; node = { code: 'RESOURCE_NOT_EXISTS' }; }
          else if (req.method === 'POST') { trade.closed = true; status = 204; }
          else node = { appid: wechat.appid, mchid: wechat.mchid, out_trade_no: id, transaction_id: `WX${id}`, trade_state: trade.paid ? 'SUCCESS' : trade.closed ? 'CLOSED' : 'NOTPAY', amount: { total: trade.amount, currency: 'CNY' } };
        } else if (req.url === '/v3/refund/domestic/refunds') {
          let refund = state.refunds.get(biz.out_refund_no);
          if (!refund) { state.transferCount++; refund = { payment: biz.out_trade_no, amount: biz.amount.refund, total: biz.amount.total, status: 'PROCESSING' }; state.refunds.set(biz.out_refund_no, refund); }
          node = { out_trade_no: refund.payment, out_refund_no: biz.out_refund_no, amount: { refund: refund.amount, total: refund.total, currency: 'CNY' }, status: refund.status };
          if (state.dropRefundResponse) { req.socket.destroy(); return; }
        } else if (req.url.startsWith('/v3/refund/domestic/refunds/')) {
          const id = req.url.split('/').at(-1), refund = state.refunds.get(id);
          if (!refund) { status = 404; node = { code: 'RESOURCE_NOT_EXISTS' }; }
          else node = { out_trade_no: refund.payment, out_refund_no: id, amount: { refund: refund.amount, total: refund.total, currency: 'CNY' }, status: refund.status };
        } else throw new Error(`Unexpected WeChat path ${req.url}`);
        if (state.override && node) node = state.override(node, kind);
        const raw = node ? JSON.stringify(node) : '';
        res.writeHead(status, { 'Content-Type': 'application/json', ...(status === 204 ? {} : signedHeaders(raw)) });
        res.end(raw);
      }
    } catch (error) { res.writeHead(500); res.end(JSON.stringify({ fixtureError: error.message })); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const transport = (url, options) => fetch(url.replace('https://platform.invalid', base), options);
  const encrypt = plain => {
    const nonce = 'abcdefghijkl', cipher = createCipheriv('aes-256-gcm', Buffer.from(apiV3Key), Buffer.from(nonce));
    cipher.setAAD(Buffer.from('fixture'));
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(plain)), cipher.final(), cipher.getAuthTag()]).toString('base64');
    return { algorithm: 'AEAD_AES_256_GCM', nonce, associated_data: 'fixture', ciphertext };
  };
  const wechatNotice = (event, data) => {
    const body = JSON.stringify({ id: randomBytes(16).toString('hex'), event_type: event, resource: encrypt(data) });
    return { body, headers: { 'Content-Type': 'application/json', ...signedHeaders(body) } };
  };
  function paidNotice(id, overrides = {}) {
    const trade = state.trades.get(id); trade.paid = true;
    if (trade.channel === 'wechat') return wechatNotice('TRANSACTION.SUCCESS', { mchid: wechat.mchid, appid: wechat.appid, out_trade_no: id,
      transaction_id: `WX${id}`, trade_state: 'SUCCESS', amount: { total: trade.amount, currency: 'CNY' }, ...overrides });
    const params = { app_id: alipay.appId, seller_id: alipay.sellerId, out_trade_no: id, trade_no: `ALI${id}`, trade_status: 'TRADE_SUCCESS',
      total_amount: (trade.amount / 100).toFixed(2), sign_type: 'RSA2', ...overrides };
    params.sign = sign(canonical(params, ['sign', 'sign_type']));
    return { body: new URLSearchParams(params).toString(), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } };
  }
  function refundNotice(id, overrides = {}, status = 'SUCCESS') {
    const refund = state.refunds.get(id); refund.status = status;
    return wechatNotice(`REFUND.${status}`, { mchid: wechat.mchid, out_trade_no: refund.payment, transaction_id: `WX${refund.payment}`,
      out_refund_no: id, refund_status: status, amount: { refund: refund.amount, total: refund.total }, ...overrides });
  }
  return { alipay, wechat, state, transport, paidNotice, refundNotice };
}
