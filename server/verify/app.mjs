// HTTP API under /api/verify/. Nginx proxies this path to 127.0.0.1 only.
import { VERIFY, ORDER_PATTERN, SERVICE_CONTRACT } from '../../assets/gettoken/verify-rules.mjs';
import { UserError } from './service.mjs';
import { checkPassword, sha256, token } from './secure.mjs';

const PREFIX = '/api/verify';
const SESSION_HOURS = 12;
const COOKIE = 'gtv_admin';

// Fixed-window counters per client and action; enough for a single small server.
function limiter(now) {
  const hits = new Map();
  return (key, limit, windowMs) => {
    const t = now();
    const entry = hits.get(key);
    if (!entry || entry.reset < t) {
      hits.set(key, { n: 1, reset: t + windowMs });
      if (hits.size > 20000) for (const [k, v] of hits) if (v.reset < t) hits.delete(k);
      return true;
    }
    entry.n += 1;
    return entry.n <= limit;
  };
}

function readBody(req, max) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > max) {
        reject(new UserError('请求内容过大', 413));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function createApp({ service, store, providers, config, now = () => Date.now(), log = () => {} }) {
  const allow = limiter(now);

  const send = (res, status, data, headers = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
    res.end(JSON.stringify(data));
  };
  const clientIp = req => {
    const remote = req.socket.remoteAddress || '';
    const local = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
    return (local && req.headers['x-real-ip']) || remote;
  };
  const json = async req => {
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw new UserError('请求格式不正确', 415);
    try {
      const data = JSON.parse((await readBody(req, 16 * 1024)) || '{}');
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new UserError('请求格式不正确');
      return data;
    } catch (error) {
      if (error instanceof UserError) throw error;
      throw new UserError('请求格式不正确');
    }
  };
  const limit = (req, action, n, windowMs) => {
    if (!allow(`${action}:${clientIp(req)}`, n, windowMs)) throw new UserError('操作太频繁，请稍后再试', 429);
  };

  function session(req) {
    const cookie = String(req.headers.cookie || '').split(/;\s*/).find(part => part.startsWith(`${COOKIE}=`));
    if (!cookie) return null;
    const row = store.get('select * from sessions where hash = ? and expires_at > ?', sha256(cookie.slice(COOKIE.length + 1)), now());
    return row ? row.hash : null;
  }
  const requireAdmin = req => {
    if (!session(req)) throw new UserError('请先登录', 401);
    // Browsers cannot add this header cross-site without a preflight we never approve.
    if (req.method !== 'GET' && req.headers['x-gettoken-admin'] !== '1') throw new UserError('请求来源不正确', 403);
  };
  const cookie = (value, maxAge) => `${COOKIE}=${value}; Path=${PREFIX}/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;

  async function notify(req, res, channel, refund = false) {
    const provider = providers[channel];
    if (!provider || !(refund ? provider.parseRefundNotify : provider.parseNotify)) return send(res, 404, { error: '未找到' });
    const raw = await readBody(req, 64 * 1024);
    try {
      const paid = refund ? provider.parseRefundNotify(raw, req.headers) : provider.parseNotify(raw, req.headers);
      if (paid) {
        const payment = store.get('select * from payments where id = ?', paid.outTradeNo);
        if (!payment || payment.channel !== channel) throw new Error(`notify for unknown payment ${paid.outTradeNo}`);
        if (refund) service.markRefund(paid.refundId, { ...paid, channel });
        else service.markPaid(payment.id, paid);
      }
      const [status, type, body] = provider.notifyReply.ok;
      res.writeHead(status, type ? { 'Content-Type': type } : {});
      res.end(body);
    } catch (error) {
      log(`${channel} notify rejected: ${error.message}`);
      const [status, type, body] = provider.notifyReply.fail;
      res.writeHead(status, type ? { 'Content-Type': type } : {});
      res.end(body);
    }
  }

  const routes = [
    ['GET', /^\/health$/, (req, res) => send(res, 200, { ok: true, mode: config.mode })],
    ['GET', /^\/config$/, (req, res) => send(res, 200, {
      mode: config.mode,
      acceptingOrders: service.acceptingNewOrders(),
      serviceContract: config.serviceContract || SERVICE_CONTRACT,
      // The existing frontend disables submission when this list is empty.
      // Configured providers stay active for old payments and refunds in the service.
      channels: service.acceptingNewOrders() ? Object.values(providers).map(p => ({ key: p.name, label: p.label })) : [],
      fees: { tech: VERIFY.techFeeMinor, audit: VERIFY.auditFeeMinor },
      reviewHours: VERIFY.reviewHours, refundHours: VERIFY.refundHours,
    })],
    ['GET', /^\/feed$/, (req, res) => send(res, 200, service.feed(), { 'Cache-Control': 'public, max-age=20' })],
    ['POST', /^\/orders$/, async (req, res) => {
      limit(req, 'create', 10, 3600_000);
      const body = await json(req);
      send(res, 201, await service.createOrder({ code: body.code, showPublic: body.showPublic, agree: body.agree, channel: body.channel, ip: clientIp(req) }));
    }],
    ['GET', /^\/orders\/([^/]+)$/, async (req, res, [id], query) => {
      limit(req, 'lookup', 120, 60_000);
      const orderId = decodeURIComponent(id).toUpperCase();
      if (!ORDER_PATTERN.test(orderId)) throw new UserError('订单号格式不正确，例如 GT-VF-1014-7KQ2AB', 400);
      send(res, 200, await service.lookup(orderId, query.get('channel')));
    }],
    ['POST', /^\/orders\/([^/]+)\/payments$/, async (req, res, [id]) => {
      limit(req, 'repay', 20, 3600_000);
      const orderId = decodeURIComponent(id).toUpperCase();
      if (!ORDER_PATTERN.test(orderId)) throw new UserError('订单号格式不正确', 400);
      const body = await json(req);
      send(res, 200, await service.requestPayment(orderId, body.channel));
    }],
    ['POST', /^\/notify\/(alipay|wechat)$/, (req, res, [channel]) => notify(req, res, channel)],
    ['POST', /^\/notify\/wechat\/refund$/, (req, res) => notify(req, res, 'wechat', true)],

    ['POST', /^\/admin\/login$/, async (req, res) => {
      limit(req, 'login', 8, 15 * 60_000);
      // The session cookie is Secure: over plain HTTP the browser drops it and the password travels in clear.
      if (req.headers['x-forwarded-proto'] === 'http') throw new UserError('请通过 https://gettoken.cc/verify/admin/ 登录后台', 403);
      const body = await json(req);
      const hash = store.setting('admin_password');
      if (!hash) throw new UserError('后台密码还没有设置，请在服务器上运行 gettoken-verify passwd', 503);
      if (!checkPassword(String(body.password || ''), hash)) throw new UserError('密码不正确', 401);
      const value = token();
      store.run('insert into sessions(hash, expires_at) values(?, ?)', sha256(value), now() + SESSION_HOURS * 3600_000);
      send(res, 200, { ok: true }, { 'Set-Cookie': cookie(value, SESSION_HOURS * 3600) });
    }],
    ['POST', /^\/admin\/logout$/, (req, res) => {
      const hash = session(req);
      if (hash) store.run('delete from sessions where hash = ?', hash);
      send(res, 200, { ok: true }, { 'Set-Cookie': cookie('', 0) });
    }],
    ['GET', /^\/admin\/me$/, (req, res) => send(res, 200, { loggedIn: !!session(req), passwordSet: !!store.setting('admin_password'), mode: config.mode })],
    ['GET', /^\/admin\/stats$/, (req, res) => { requireAdmin(req); send(res, 200, service.stats()); }],
    ['GET', /^\/admin\/orders$/, (req, res, _, query) => {
      requireAdmin(req);
      send(res, 200, service.adminList({ status: query.get('status') || '', q: query.get('q') || '', page: Number(query.get('page')) || 1 }));
    }],
    ['GET', /^\/admin\/orders\/([^/]+)$/, (req, res, [id]) => { requireAdmin(req); send(res, 200, service.adminDetail(decodeURIComponent(id))); }],
    ['POST', /^\/admin\/orders\/([^/]+)\/decision$/, async (req, res, [id]) => {
      requireAdmin(req);
      const body = await json(req);
      const orderId = decodeURIComponent(id);
      service.decide(orderId, body.result, body.reason);
      // Refund the audit fee right away; the background job retries if the platform is slow.
      if (body.result === 'failed') {
        const refund = store.get("select * from refunds where order_id = ? and kind = 'audit'", orderId);
        if (refund) await service.runRefund(refund, 'admin');
      }
      send(res, 200, service.adminDetail(orderId));
    }],
    ['POST', /^\/admin\/orders\/([^/]+)\/refund$/, async (req, res, [id]) => {
      requireAdmin(req);
      await service.retryRefund(decodeURIComponent(id));
      send(res, 200, service.adminDetail(decodeURIComponent(id)));
    }],
    ['POST', /^\/admin\/orders\/([^/]+)\/mock-pay$/, (req, res, [id]) => {
      requireAdmin(req);
      if (config.mode !== 'mock') throw new UserError('只有测试模式可以模拟收款', 403);
      const payment = store.get("select * from payments where order_id = ? and status = 'pending' order by created_at desc limit 1", decodeURIComponent(id));
      if (!payment) throw new UserError('这个订单没有待付款的二维码', 409);
      service.markPaid(payment.id, { tradeNo: `TEST-${payment.id}`, amountMinor: payment.amount });
      service.event(payment.order_id, 'admin', 'mock_paid');
      send(res, 200, service.adminDetail(payment.order_id));
    }],
  ];

  return async function handle(req, res) {
    const address = new URL(req.url, 'http://localhost');
    if (!address.pathname.startsWith(`${PREFIX}/`)) return send(res, 404, { error: '未找到' });
    const path = address.pathname.slice(PREFIX.length);
    try {
      for (const [method, pattern, handler] of routes) {
        const match = pattern.exec(path);
        if (!match) continue;
        if (req.method !== method && !(method === 'GET' && req.method === 'HEAD')) continue;
        return await handler(req, res, match.slice(1), address.searchParams);
      }
      send(res, 404, { error: '未找到' });
    } catch (error) {
      if (error instanceof UserError) return send(res, error.status, { error: error.message });
      if (error instanceof URIError) return send(res, 400, { error: '请求地址不正确' });
      log(`${req.method} ${path}: ${error.stack || error.message}`);
      send(res, 500, { error: '服务暂时出错，请稍后再试' });
    }
  };
}
