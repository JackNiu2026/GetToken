// Short, revocable bearer URLs. Payloads are encrypted; no external converter is involved.
import { buildSubscription, SUBSCRIPTION_DAYS } from '../../assets/gettoken/clash-config.mjs';
import { sealCode, openCode, token, sha256 } from './secure.mjs';

const PREFIX = '/api/clash/subscriptions';
const TOKEN = /^[\w-]{43}$/;
const MAX_BODY = 64 * 1024;
const TTL = SUBSCRIPTION_DAYS * 86400_000;

async function readJSON(req) {
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw Object.assign(new Error('请使用 JSON 格式'), { status: 415 });
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw Object.assign(new Error('代理内容过大，请减少节点后重试'), { status: 413 });
    chunks.push(chunk);
  }
  let data;
  try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw Object.assign(new Error('请求格式不正确'), { status: 400 }); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw Object.assign(new Error('请求格式不正确'), { status: 400 });
  return data;
}

export function purgeClashSubscriptions(store, now = Date.now()) {
  store.run('delete from clash_subscriptions where expires_at <= ?', now);
}

export function createClashHandler({ store, config, now = () => Date.now() }) {
  const hits = new Map();
  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff', ...headers,
    });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  };
  return async (req, res) => {
    try {
      const path = new URL(req.url, 'http://localhost').pathname;
      const key = path.startsWith(`${PREFIX}/`) ? path.slice(PREFIX.length + 1) : '';
      if (path === PREFIX && req.method === 'POST') {
        if (req.headers['x-gettoken-clash'] !== '1' || (req.headers.origin && req.headers.origin !== config.origin)) return send(res, 403, { error: '请求来源不正确，请在本站页面重试' });
        const remote = req.socket.remoteAddress || '';
        const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote);
        const ip = local && req.headers['x-real-ip'] ? req.headers['x-real-ip'] : remote;
        const time = now();
        for (const [id, row] of hits) if (row.until <= time) hits.delete(id);
        let hit = hits.get(ip);
        if (!hit) { hit = { count: 0, until: time + 3600_000 }; hits.set(ip, hit); }
        if (++hit.count > 20 || hits.size > 20000) return send(res, 429, { error: '生成过于频繁，请稍后重试；仍可下载本地配置' }, { 'Retry-After': '3600' });
        const data = await readJSON(req);
        let result;
        try { result = buildSubscription(data); } catch (error) { return send(res, 400, { error: error.message }); }
        purgeClashSubscriptions(store, time);
        if (store.get('select count(*) as n from clash_subscriptions').n >= 5000) return send(res, 503, { error: '订阅服务暂满，请先下载 YAML 配置' });
        const access = token(), manage = token();
        const expiresAt = time + TTL;
        store.run('insert into clash_subscriptions(token_hash, manage_hash, config_sealed, expires_at, format) values(?, ?, ?, ?, ?)', sha256(access), sha256(manage), sealCode(config.secret, result.yaml), expiresAt, result.format);
        return send(res, 201, { path: `${PREFIX}/${access}`, manageToken: manage, expiresAt, count: result.count, format: result.format });
      }
      if (!TOKEN.test(key)) return send(res, 404, { error: '订阅不存在或已失效，请重新生成' });
      const row = store.get('select * from clash_subscriptions where token_hash = ? and expires_at > ?', sha256(key), now());
      if (!row) return send(res, 404, { error: '订阅不存在或已失效，请重新生成' });
      if (req.method === 'GET' || req.method === 'HEAD') {
        const yaml = openCode(config.secret, row.config_sealed);
        const filename = row.format === 'shadowrocket' ? 'gettoken-shadowrocket.yaml' : 'gettoken-clash.yaml';
        return send(res, 200, req.method === 'HEAD' ? '' : yaml, { 'Content-Type': 'text/yaml; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}"`, 'Profile-Update-Interval': '24' });
      }
      if (req.method === 'DELETE') {
        const manage = String(req.headers['x-gettoken-clash-manage'] || '');
        if (!TOKEN.test(manage) || sha256(manage) !== row.manage_hash) return send(res, 403, { error: '无法撤销此订阅，请使用生成时的页面' });
        store.run('delete from clash_subscriptions where token_hash = ?', sha256(key));
        return send(res, 200, { ok: true });
      }
      return send(res, 405, { error: '请求方法不支持' }, { Allow: 'GET, HEAD, DELETE' });
    } catch (error) {
      // Deliberately omit the request path, body and crypto errors from logs.
      return send(res, error.status || 500, { error: error.status ? error.message : '订阅服务暂时不可用，请先下载 YAML 配置' });
    }
  };
}
