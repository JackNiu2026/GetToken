// Shared by the browser and subscription API. This module never connects to a proxy.
export const MAX_PROXIES = 100;
export const MAX_SOURCE = 12000;
export const SUBSCRIPTION_DAYS = 30;
const quote = value => JSON.stringify(value);
const cleanText = value => !/[\u0000-\u001f\u007f-\u009f\u2028\u2029\ud800-\udfff]/u.test(value);

function parseLine(line) {
  let host, port, username = '', password = '', name = '';
  const colonFormat = /^(\[[^\]]+\]|[^:\s]+):([0-9]+)(?::([^:]+):(.+))?$/.exec(line);
  if (!colonFormat && (line.includes('://') || line.includes('@'))) {
    if (line.includes('://') && !/^socks5:\/\//i.test(line)) throw new Error('仅支持 socks5:// 协议');
    const raw = line.replace(/^socks5:\/\//i, '');
    // URL accepts a missing/default port and normalizes some invalid IPv4 forms; reject both.
    const authority = raw.split(/[/?#]/)[0].split('@').at(-1);
    if (!/^(?:\[[0-9a-fA-F:.]+\]|[^:\s]+):[0-9]+$/.test(authority)) throw new Error('请填写完整的主机和端口，IPv6 地址请加方括号');
    let parsed;
    try { parsed = new URL(`socks5://${raw}`); } catch { throw new Error('代理链接格式不正确'); }
    if (parsed.search || (parsed.pathname && parsed.pathname !== '/')) throw new Error('代理链接不能带路径或查询参数');
    host = parsed.hostname.replace(/^\[|\]$/g, '');
    port = parsed.port;
    try {
      username = decodeURIComponent(parsed.username);
      password = decodeURIComponent(parsed.password);
      name = decodeURIComponent(parsed.hash.slice(1));
    } catch { throw new Error('百分号编码不正确，请用 %25 表示百分号'); }
  } else {
    const match = colonFormat;
    if (!match) throw new Error('支持 IP:端口、IP:端口:账号:密码或 SOCKS5 链接');
    [, host, port, username = '', password = ''] = match;
    host = host.replace(/^\[|\]$/g, '');
  }
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
  if (name.length > 80 || username.length > 255 || password.length > 255) throw new Error('名称最多 80 字，账号和密码各最多 255 字');
  return { host, port: n, username, password, name: name || `${host}:${n}` };
}

export function parseProxies(source) {
  if (typeof source !== 'string' || source.length > MAX_SOURCE) throw new Error(`代理内容最多 ${MAX_SOURCE} 个字符`);
  const lines = source.split(/\r?\n/).map((line, index) => ({ line: line.trim(), index })).filter(x => x.line);
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

export function buildClashConfig({ source, name = 'SOCKS5 订阅', udp = false } = {}) {
  if (typeof name !== 'string' || !name.trim() || name.length > 60 || !cleanText(name)) throw new Error('订阅名称需为 1–60 字，不能包含换行');
  if (typeof udp !== 'boolean') throw new Error('UDP 选项不正确');
  const proxies = parseProxies(source);
  const yaml = [
    `# ${name.trim()}`, 'mixed-port: 7897', 'allow-lan: false', 'mode: rule', 'log-level: info', 'proxies:',
    ...proxies.flatMap(p => [
      `  - name: ${quote(p.name)}`, '    type: socks5', `    server: ${quote(p.host)}`, `    port: ${p.port}`,
      ...(p.username ? [`    username: ${quote(p.username)}`, `    password: ${quote(p.password)}`] : []),
      `    udp: ${udp}`,
    ]),
    'proxy-groups:', '  - name: PROXY', '    type: select', '    proxies:',
    ...proxies.map(p => `      - ${quote(p.name)}`), '      - DIRECT',
    'rules:', '  - MATCH,PROXY', '',
  ].join('\n');
  return { yaml, count: proxies.length, name: name.trim() };
}
