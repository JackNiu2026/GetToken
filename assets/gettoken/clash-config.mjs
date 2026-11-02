// Shared by the browser and subscription API. This module never connects to a proxy.
export const MAX_PROXIES = 100;
export const MAX_SOURCE = 12000;
export const SUBSCRIPTION_DAYS = 30;
const quote = value => JSON.stringify(value);
const cleanText = value => !/[\u0000-\u001f\u007f-\u009f\u2028\u2029\ud800-\udfff]/u.test(value);
const bytes = value => new TextEncoder().encode(value);
const colonMatch = line => /^(\[[^\]]+\]|[^:@\s]+):([0-9]+)(?::([^:]+):(.+))?$/.exec(line);

export function encodeBase64(value) {
  return btoa(Array.from(bytes(value), byte => String.fromCharCode(byte)).join(''));
}

function decodeBase64(value) {
  const text = value.replace(/-/g, '+').replace(/_/g, '/');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(text) || text.length % 4 === 1 || (text.includes('=') && text.length % 4 !== 0)) throw new Error('Base64 编码不正确');
  try {
    const binary = atob(text);
    if (btoa(binary).replace(/=+$/, '') !== text.replace(/=+$/, '')) throw new Error();
    return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(binary, c => c.charCodeAt(0)));
  } catch { throw new Error('Base64 编码或 UTF-8 文本不正确'); }
}

function decodeText(text) {
  try { return decodeURIComponent(text); } catch { throw new Error('百分号编码不正确，请用 %25 表示百分号'); }
}

function credentials(text, encoded = false) {
  const separator = text.indexOf(':');
  if (separator < 0) throw new Error('账号和密码需要用冒号分隔');
  const user = text.slice(0, separator), pass = text.slice(separator + 1);
  return encoded ? [decodeText(user), decodeText(pass)] : [user, pass];
}

function parseLine(line) {
  let host, port, username = '', password = '', name = '';
  // Recognize vendor colon format first: @, :// and literal % may all be password characters.
  const plain = colonMatch(line) || colonMatch(line.trim());
  if (plain && line.includes('@') && /^(?:\[[^\]]+\]|[^:\s/?#]+):[0-9]+$/.test(line.slice(line.lastIndexOf('@') + 1).trim())) {
    throw new Error('格式存在歧义，请改用 socks5://账号:密码@主机:端口，并对凭据中的特殊字符进行百分号编码');
  }
  if (plain) [, host, port, username = '', password = ''] = plain;
  else {
    const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(line);
    if (scheme && !/^(socks5|socks5h|socks)$/i.test(scheme[1])) throw new Error('仅支持 socks5://、socks5h:// 或 socks://；不能将其他协议当作 SOCKS5');
    if (!scheme && !line.includes('@')) throw new Error('支持 IP:端口、IP:端口:账号:密码或 SOCKS5 链接');
    const protocol = scheme?.[1].toLowerCase() || 'socks5';
    let raw = scheme ? line.slice(scheme[0].length) : line;
    const fragment = raw.indexOf('#');
    if (fragment >= 0) { name = decodeText(raw.slice(fragment + 1).trimEnd()); raw = raw.slice(0, fragment); }
    const query = raw.indexOf('?');
    if (query >= 0) {
      const params = new URLSearchParams(raw.slice(query + 1));
      if ([...params.keys()].some(key => !['remarks', 'remark'].includes(key)) || params.size > 1) throw new Error('不支持的查询参数，请保留地址、端口、凭据及节点名称；TLS 等设置不能忽略');
      name ||= params.get('remarks') || params.get('remark') || '';
      raw = raw.slice(0, query);
    }
    raw = raw.trimEnd();
    let legacy = false;
    // Legacy Shadowrocket form encodes the full user:password@host:port.
    if (protocol === 'socks' && !raw.includes('@') && !colonMatch(raw)) { raw = decodeBase64(decodeText(raw)); legacy = true; }
    // An explicit URI (including decoded full-address Base64) uses its final @ as
    // the endpoint delimiter. A numeric password prefix must never become a port.
    const vendor = raw.includes('@') ? null : colonMatch(raw);
    if (vendor) {
      [, host, port, username = '', password = ''] = vendor;
      if (!legacy) { username = decodeText(username); password = decodeText(password); }
    } else {
      const at = raw.lastIndexOf('@');
      let endpoint = at >= 0 ? raw.slice(at + 1) : raw;
      if (at >= 0) {
        const auth = raw.slice(0, at);
        if (legacy) [username, password] = credentials(auth);
        else if (auth.includes(':')) [username, password] = credentials(auth, true);
        else [username, password] = credentials(decodeBase64(decodeText(auth)));
      }
      if (endpoint.endsWith('/')) endpoint = endpoint.slice(0, -1);
      const address = /^(\[[^\]]+\]|[^:\s/?#]+):([0-9]+)$/.exec(endpoint);
      if (!address) throw new Error('请填写完整的主机和端口，IPv6 地址请加方括号；链接不能带路径');
      [, host, port] = address;
    }
  }
  host = host.replace(/^\[|\]$/g, '');
  const n = Number(port);
  if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error('端口必须是 1–65535 的整数');
  if (host.includes(':')) {
    try { new URL(`http://[${host}]/`); } catch { throw new Error('IPv6 地址不正确'); }
  } else if (/^[\d.]+$/.test(host)) {
    if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(host) || host.split('.').some(x => Number(x) > 255 || (x.length > 1 && x.startsWith('0')))) throw new Error('IPv4 地址不正确');
  } else if (host.length > 253 || !host.split('.').every(x => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(x))) {
    throw new Error('主机应为有效 IP 或域名');
  }
  if (Boolean(username) !== Boolean(password)) throw new Error('账号和密码需要同时填写');
  if (![host, username, password, name].every(cleanText)) throw new Error('名称或凭据不能包含控制字符');
  if (name.length > 80 || bytes(username).length > 255 || bytes(password).length > 255) throw new Error('名称最多 80 字，账号和密码的 UTF-8 编码各最多 255 字节');
  return { host, port: n, username, password, name: name || `${host.includes(':') ? `[${host}]` : host}:${n}` };
}

export function parseProxies(source) {
  if (typeof source !== 'string' || source.length > MAX_SOURCE) throw new Error(`代理内容最多 ${MAX_SOURCE} 个字符`);
  // Preserve trailing whitespace in colon-format passwords; ignore blank/indented lines.
  const lines = source.split(/\r\n|\r|\n/).map((line, index) => ({ line: line.trimStart(), index })).filter(x => x.line.trim());
  if (!lines.length) throw new Error('请先填写至少一个 SOCKS5 代理');
  if (lines.length > MAX_PROXIES) throw new Error(`一次最多转换 ${MAX_PROXIES} 个代理`);
  const used = new Set(['PROXY', 'DIRECT', 'REJECT']);
  return lines.map(({ line, index }) => {
    let proxy;
    try { proxy = parseLine(line); } catch (error) { throw new Error(`第 ${index + 1} 行：${error.message}`); }
    const base = proxy.name;
    for (let i = 2; used.has(proxy.name); i += 1) proxy.name = `${base} (${i})`;
    used.add(proxy.name);
    return proxy;
  });
}

export function validateUpstreamUrl(value) {
  const message = '前置订阅需为有效的 HTTPS 链接（最多 4096 字符），不能包含登录信息或片段';
  if (typeof value !== 'string' || value.length > 4096 || !cleanText(value) || !/^https:\/\//i.test(value.trim())) throw new Error(message);
  let url;
  try { url = new URL(value.trim()); } catch { throw new Error(message); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || /\s/.test(value.trim())) throw new Error(message);
  if (['gettoken.cc', 'www.gettoken.cc'].includes(url.hostname) && url.pathname.startsWith('/api/clash/subscriptions')) throw new Error('请填写供应商的原始前置订阅，不要使用本站生成的订阅链接');
  return url.href;
}

export function buildClashConfig({ source, name = 'SOCKS5 订阅', udp = false, routing = 'all', connection = 'direct', upstreamUrl = '' } = {}) {
  if (typeof name !== 'string' || !name.trim() || name.length > 60 || !cleanText(name)) throw new Error('订阅名称需为 1–60 字，不能包含换行');
  if (typeof udp !== 'boolean') throw new Error('UDP 选项不正确');
  if (!['all', 'bypass-cn'].includes(routing)) throw new Error('请选择有效的 Clash 分流规则');
  if (!['direct', 'chain'].includes(connection)) throw new Error('请选择直连或链式代理');
  const upstream = connection === 'chain' ? validateUpstreamUrl(upstreamUrl) : '';
  const chained = connection === 'chain';
  const directRules = routing === 'bypass-cn' ? [
    'IP-CIDR,127.0.0.0/8,DIRECT,no-resolve',
    'IP-CIDR,10.0.0.0/8,DIRECT,no-resolve',
    'IP-CIDR,172.16.0.0/12,DIRECT,no-resolve',
    'IP-CIDR,192.168.0.0/16,DIRECT,no-resolve',
    'IP-CIDR,169.254.0.0/16,DIRECT,no-resolve',
    'IP-CIDR6,::1/128,DIRECT,no-resolve',
    'IP-CIDR6,fc00::/7,DIRECT,no-resolve',
    'IP-CIDR6,fe80::/10,DIRECT,no-resolve',
    'GEOIP,CN,DIRECT',
  ] : [];
  const proxies = parseProxies(source).map(p => ({ ...p, name: chained ? `住宅 · ${p.name}` : p.name }));
  const yaml = [
    `# ${name.trim()}`, 'mixed-port: 7897', 'allow-lan: false', 'mode: rule', 'log-level: info',
    ...(chained ? ['profile:', '  store-selected: true', 'proxy-providers:', '  upstream:', '    type: http', `    url: ${quote(upstream)}`, '    interval: 3600', '    proxy: DIRECT', '    exclude-type: direct|reject|dns|compatible', '    override:', '      additional-prefix: "前置 · "', '      dialer-proxy: DIRECT', '    health-check:', '      enable: false'] : []),
    'proxies:',
    ...proxies.flatMap(p => [
      `  - name: ${quote(p.name)}`, '    type: socks5', `    server: ${quote(p.host)}`, `    port: ${p.port}`,
      ...(p.username ? [`    username: ${quote(p.username)}`, `    password: ${quote(p.password)}`] : []),
      `    udp: ${udp}`, ...(chained ? ['    dialer-proxy: UPSTREAM-AUTO'] : []),
    ]),
    'proxy-groups:',
    ...(chained ? ['  - name: UPSTREAM-AUTO', '    type: fallback', '    hidden: true', '    url: https://www.gstatic.com/generate_204', '    interval: 300', '    lazy: false', '    use:', '      - upstream', '    empty-fallback: REJECT'] : []),
    `  - name: ${chained ? '链式出口' : 'PROXY'}`, '    type: select', '    proxies:',
    ...proxies.map(p => `      - ${quote(p.name)}`), ...(chained ? [] : ['      - DIRECT']),
    'rules:', ...directRules.map(rule => `  - ${rule}`), `  - MATCH,${chained ? '链式出口' : 'PROXY'}`, '',
  ].join('\n');
  return { yaml, count: proxies.length, name: name.trim(), connection };
}

export function buildSubscription({ format = 'clash', ...input } = {}) {
  if (!['clash', 'shadowrocket'].includes(format)) throw new Error('请选择 Clash 或小火箭订阅格式');
  if (format === 'shadowrocket' && input.connection === 'chain') throw new Error('链式代理仅支持 Clash Verge Rev / Mihomo，请切换客户端或选择直连');
  const result = buildClashConfig(input);
  if (format === 'shadowrocket') {
    // Shadowrocket accepts a YAML proxies list (same representation as Sub-Store's producer).
    // Keep structured credentials instead of lossy colon-delimited share-link encodings.
    result.yaml = `# ${result.name}\nproxies:\n` + parseProxies(input.source).map(p => `  - ${JSON.stringify({ name: p.name, type: 'socks5', server: p.host, port: p.port, ...(p.username ? { username: p.username, password: p.password } : {}), udp: input.udp ?? false })}\n`).join('');
  }
  return { ...result, format };
}

export function subscriptionImportLink(url, name, format = 'clash') {
  const address = new URL(url);
  if (!['https:', 'http:'].includes(address.protocol) || address.username || address.password) throw new Error('订阅地址不正确');
  if (format === 'shadowrocket') return `shadowrocket://add/sub://${encodeBase64(address.href)}?remark=${encodeURIComponent(name)}`;
  if (format !== 'clash') throw new Error('订阅格式不正确');
  return `clash://install-config?url=${encodeURIComponent(address.href)}&name=${encodeURIComponent(name)}`;
}
