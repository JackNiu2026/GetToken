// Alipay 当面付 (alipay.trade.precreate): a QR code the payer scans with the Alipay app.
// Public-key mode with RSA2 signatures. Docs: https://opendocs.alipay.com/open/194/106078
import { createSign, createVerify } from 'node:crypto';
import { privateKey, publicKey, yuanToMinor, minorToYuan, beijingTime } from './keys.mjs';

// Requests sign every non-empty parameter except `sign` (sign_type included);
// notifications are verified without both `sign` and `sign_type`.
function content(params, skip) {
  return Object.keys(params)
    .filter(key => !skip.includes(key) && params[key] !== undefined && params[key] !== null && params[key] !== '')
    .sort()
    .map(key => `${key}=${params[key]}`)
    .join('&');
}
export const requestSignContent = params => content(params, ['sign']);
export const notifySignContent = params => content(params, ['sign', 'sign_type']);

// The signed text is the raw JSON of the response node, exactly as sent.
export function rawNode(text, key) {
  const at = text.indexOf(`"${key}"`);
  if (at < 0) return null;
  let i = text.indexOf(':', at + key.length + 2) + 1;
  while (/\s/.test(text[i])) i += 1;
  if (text[i] !== '{') return null;
  let depth = 0;
  let inString = false;
  for (let j = i; j < text.length; j += 1) {
    const c = text[j];
    if (inString) {
      if (c === '\\') j += 1;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === '{') depth += 1;
    else if (c === '}' && --depth === 0) return text.slice(i, j + 1);
  }
  return null;
}

export function alipayProvider(config, { fetch = globalThis.fetch, now = () => Date.now(), notifyUrl }) {
  const appKey = privateKey(config.privateKey);
  const platformKey = publicKey(config.publicKey);
  const sign = text => createSign('RSA-SHA256').update(text, 'utf8').sign(appKey, 'base64');
  const verify = (text, signature) => {
    try {
      return createVerify('RSA-SHA256').update(text, 'utf8').verify(platformKey, signature, 'base64');
    } catch {
      return false;
    }
  };

  async function call(method, biz, extra = {}) {
    const params = {
      app_id: config.appId, method, format: 'JSON', charset: 'utf-8', sign_type: 'RSA2',
      timestamp: beijingTime(now()), version: '1.0', ...extra, biz_content: JSON.stringify(biz),
    };
    params.sign = sign(requestSignContent(params));
    const response = await fetch(config.gateway, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
      body: new URLSearchParams(params).toString(),
      signal: AbortSignal.timeout(15000),
    });
    const text = await response.text();
    const key = `${method.replaceAll('.', '_')}_response`;
    const raw = rawNode(text, key) ?? rawNode(text, 'error_response');
    if (!raw) throw new Error(`Alipay ${method}: unexpected response (${response.status})`);
    const node = JSON.parse(raw);
    if (node.code === '10000' || node.code === '40004') {
      // Business results must carry a valid platform signature before we act on them.
      const signature = JSON.parse(text).sign;
      if (!signature || !verify(raw, signature)) throw new Error(`Alipay ${method}: response signature invalid`);
    }
    return node;
  }

  return {
    name: 'alipay',
    label: '支付宝',
    async precreate({ outTradeNo, amountMinor, subject, expiresAt }) {
      const minutes = Math.max(1, Math.round((expiresAt - now()) / 60000));
      const node = await call('alipay.trade.precreate', { out_trade_no: outTradeNo, total_amount: minorToYuan(amountMinor), subject, timeout_express: `${minutes}m` }, { notify_url: notifyUrl });
      if (node.code !== '10000' || !node.qr_code) throw new Error(`Alipay precreate: ${node.sub_msg || node.msg || node.code}`);
      return { qr: node.qr_code };
    },
    async query(outTradeNo) {
      const node = await call('alipay.trade.query', { out_trade_no: outTradeNo });
      if (node.code === '40004') return { paid: false };
      if (node.code !== '10000') throw new Error(`Alipay query: ${node.sub_msg || node.msg}`);
      const paid = node.trade_status === 'TRADE_SUCCESS' || node.trade_status === 'TRADE_FINISHED';
      return { paid, tradeNo: node.trade_no, amountMinor: yuanToMinor(node.total_amount) };
    },
    async refund({ outTradeNo, refundId, amountMinor, reason }) {
      const node = await call('alipay.trade.refund', { out_trade_no: outTradeNo, refund_amount: minorToYuan(amountMinor), out_request_no: refundId, refund_reason: reason });
      // fund_change=Y means money moved now; otherwise confirm with the refund query.
      if (node.code === '10000') return { status: node.fund_change === 'Y' ? 'success' : 'processing' };
      return { status: 'error', error: node.sub_msg || node.msg || node.code };
    },
    async refundQuery({ outTradeNo, refundId }) {
      const node = await call('alipay.trade.fastpay.refund.query', { out_trade_no: outTradeNo, out_request_no: refundId });
      if (node.code === '10000' && node.refund_status === 'REFUND_SUCCESS') return { status: 'success' };
      if (node.code === '10000' || node.code === '40004') return { status: 'processing' };
      return { status: 'error', error: node.sub_msg || node.msg };
    },
    // POSTed form from Alipay. Returns the paid payment or null; the reply body must be "success".
    parseNotify(rawBody) {
      const params = Object.fromEntries(new URLSearchParams(rawBody));
      if (!params.sign || !verify(notifySignContent(params), params.sign)) throw new Error('Alipay notify: signature invalid');
      if (params.app_id !== config.appId) throw new Error('Alipay notify: wrong app_id');
      const paid = params.trade_status === 'TRADE_SUCCESS' || params.trade_status === 'TRADE_FINISHED';
      return paid ? { outTradeNo: params.out_trade_no, tradeNo: params.trade_no, amountMinor: yuanToMinor(params.total_amount) } : null;
    },
    notifyReply: { ok: [200, 'text/plain', 'success'], fail: [200, 'text/plain', 'fail'] },
  };
}
