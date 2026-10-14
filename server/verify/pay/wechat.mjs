// WeChat Pay API v3, Native payment: a code_url the payer scans with WeChat.
// Responses and notifications are verified with the WeChat Pay public key (微信支付公钥 mode).
// Docs: https://pay.weixin.qq.com/doc/v3/merchant/4012791874
import { createSign, createVerify, createDecipheriv, randomBytes } from 'node:crypto';
import { privateKey, publicKey, beijingTime } from './keys.mjs';

const FIVE_MINUTES = 300;

export function decryptResource(apiV3Key, { ciphertext, nonce, associated_data: aad = '' }) {
  const raw = Buffer.from(ciphertext, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(apiV3Key, 'utf8'), Buffer.from(nonce, 'utf8'));
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(raw.subarray(raw.length - 16));
  return JSON.parse(Buffer.concat([decipher.update(raw.subarray(0, raw.length - 16)), decipher.final()]).toString('utf8'));
}

export function wechatProvider(config, { fetch = globalThis.fetch, now = () => Date.now(), notifyUrl }) {
  const merchantKey = privateKey(config.privateKey);
  const platformKey = publicKey(config.platformKey);
  const header = (headers, name) => (typeof headers.get === 'function' ? headers.get(name) : headers[name.toLowerCase()]) || '';

  function verifySignature(headers, body) {
    const serial = header(headers, 'wechatpay-serial');
    const timestamp = header(headers, 'wechatpay-timestamp');
    const nonce = header(headers, 'wechatpay-nonce');
    const signature = header(headers, 'wechatpay-signature');
    if (serial !== config.platformKeyId) throw new Error(`WeChat Pay: unknown signing key ${serial || '(none)'}`);
    if (!/^\d+$/.test(timestamp) || Math.abs(now() / 1000 - Number(timestamp)) > FIVE_MINUTES) throw new Error('WeChat Pay: stale signature timestamp');
    const ok = createVerify('RSA-SHA256').update(`${timestamp}\n${nonce}\n${body}\n`, 'utf8').verify(platformKey, signature, 'base64');
    if (!ok) throw new Error('WeChat Pay: signature invalid');
  }

  async function call(method, path, payload) {
    const body = payload ? JSON.stringify(payload) : '';
    const timestamp = String(Math.floor(now() / 1000));
    const nonce = randomBytes(16).toString('hex');
    const signature = createSign('RSA-SHA256').update(`${method}\n${path}\n${timestamp}\n${nonce}\n${body}\n`, 'utf8').sign(merchantKey, 'base64');
    const response = await fetch(config.base + path, {
      method,
      headers: {
        Authorization: `WECHATPAY2-SHA256-RSA2048 mchid="${config.mchid}",nonce_str="${nonce}",signature="${signature}",timestamp="${timestamp}",serial_no="${config.serialNo}"`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'GetToken-Verify/1.0',
        'Wechatpay-Serial': config.platformKeyId,
      },
      body: body || undefined,
      signal: AbortSignal.timeout(15000),
    });
    const text = await response.text();
    if (response.ok) verifySignature(response.headers, text);
    const data = text ? JSON.parse(text) : {};
    return { status: response.status, ok: response.ok, data };
  }

  const refundStatus = data => {
    if (data.status === 'SUCCESS') return { status: 'success' };
    if (data.status === 'PROCESSING') return { status: 'processing' };
    return { status: 'error', error: `退款状态 ${data.status}` };
  };

  return {
    name: 'wechat',
    label: '微信支付',
    async precreate({ outTradeNo, amountMinor, subject, expiresAt }) {
      const result = await call('POST', '/v3/pay/transactions/native', {
        appid: config.appid, mchid: config.mchid, description: subject.slice(0, 120), out_trade_no: outTradeNo,
        time_expire: beijingTime(expiresAt, true), notify_url: notifyUrl, amount: { total: amountMinor, currency: 'CNY' },
      });
      if (!result.ok || !result.data.code_url) throw new Error(`WeChat Pay native: ${result.data.message || result.status}`);
      return { qr: result.data.code_url };
    },
    async query(outTradeNo) {
      const result = await call('GET', `/v3/pay/transactions/out-trade-no/${encodeURIComponent(outTradeNo)}?mchid=${encodeURIComponent(config.mchid)}`);
      if (result.status === 404) return { paid: false };
      if (!result.ok) throw new Error(`WeChat Pay query: ${result.data.message || result.status}`);
      return { paid: result.data.trade_state === 'SUCCESS', tradeNo: result.data.transaction_id, amountMinor: result.data.amount?.total };
    },
    async refund({ outTradeNo, refundId, amountMinor, totalMinor, reason }) {
      const result = await call('POST', '/v3/refund/domestic/refunds', {
        out_trade_no: outTradeNo, out_refund_no: refundId, reason, amount: { refund: amountMinor, total: totalMinor, currency: 'CNY' },
      });
      if (!result.ok) return { status: 'error', error: result.data.message || `HTTP ${result.status}` };
      return refundStatus(result.data);
    },
    async refundQuery({ refundId }) {
      const result = await call('GET', `/v3/refund/domestic/refunds/${encodeURIComponent(refundId)}`);
      if (!result.ok) return { status: 'error', error: result.data.message || `HTTP ${result.status}` };
      return refundStatus(result.data);
    },
    parseNotify(rawBody, headers) {
      verifySignature(headers, rawBody);
      const message = JSON.parse(rawBody);
      if (message.event_type !== 'TRANSACTION.SUCCESS') return null;
      const tx = decryptResource(config.apiV3Key, message.resource);
      if (tx.mchid !== config.mchid || tx.appid !== config.appid) throw new Error('WeChat Pay notify: wrong merchant');
      if (tx.trade_state !== 'SUCCESS') return null;
      return { outTradeNo: tx.out_trade_no, tradeNo: tx.transaction_id, amountMinor: tx.amount?.total };
    },
    notifyReply: { ok: [204, null, ''], fail: [500, 'application/json', JSON.stringify({ code: 'FAIL', message: '处理失败' })] },
  };
}
