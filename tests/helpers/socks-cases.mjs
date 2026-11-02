// Synthetic, independently specified connection details; no real proxy credentials.
const base64 = value => Buffer.from(value, 'utf8').toString('base64');
const expected = (host = '203.0.113.10', port = 1080, username = '', password = '') => ({ host, port, username, password });

export const SOCKS_CASES = [
  ['IPv4', '203.0.113.10:1080', expected()],
  ['domain', 'proxy.example:1080', expected('proxy.example')],
  ['IPv6', '[2001:db8::1]:1080', expected('2001:db8::1')],
  ['IPv4 mapped IPv6', '[::ffff:203.0.113.10]:1080', expected('::ffff:203.0.113.10')],
  ['bare credentials', 'u:p@203.0.113.10:1080', expected(undefined, undefined, 'u', 'p')],
  ['bare IPv6 credentials', 'u:p@[2001:db8::1]:1080', expected('2001:db8::1', 1080, 'u', 'p')],
  ['socks5 URI', 'socks5://u:p@203.0.113.10:1080#节点', expected(undefined, undefined, 'u', 'p')],
  ['uppercase scheme', 'SOCKS5://u:p@203.0.113.10:1080', expected(undefined, undefined, 'u', 'p')],
  ['remote DNS scheme', 'socks5h://u:p@203.0.113.10:1080', expected(undefined, undefined, 'u', 'p')],
  ['URI without auth', 'socks5://203.0.113.10:1080/', expected()],
  ['socks URI without auth', 'socks://203.0.113.10:1080', expected()],
  ['vendor URI', 'socks5://203.0.113.10:1080:u:p%40ss', expected(undefined, undefined, 'u', 'p@ss')],
  ['encoded username colon', 'socks5://u%3Aser:p%3A%40%25%2F%23%3F@203.0.113.10:1080', expected(undefined, undefined, 'u:ser', 'p:@%/#?')],
  ['userinfo Base64', `socks://${base64('u:p')}@203.0.113.10:1080#Base64`, expected(undefined, undefined, 'u', 'p')],
  ['socks5 userinfo Base64', `socks5://${base64('u:p')}@203.0.113.10:1080`, expected(undefined, undefined, 'u', 'p')],
  ['full Base64', `socks://${base64('u:p@203.0.113.10:1080')}#旧版`, expected(undefined, undefined, 'u', 'p')],
  ['full Base64 URL-safe', `socks://${Buffer.from('u:p@203.0.113.10:1080').toString('base64url')}?remarks=旧版`, expected(undefined, undefined, 'u', 'p')],
  ['full Base64 without auth', `socks://${base64('203.0.113.10:1080')}`, expected()],
  ['Base64 IPv6', `socks://${base64('u:p@[2001:db8::1]:1080')}`, expected('2001:db8::1', 1080, 'u', 'p')],
  ['legacy numeric multi-colon password', `socks://${base64('demo:1234:part:tail@203.0.113.10:1080')}`, expected(undefined, undefined, 'demo', '1234:part:tail')],
  ['URI numeric multi-colon password', 'socks5://demo:1234:part:tail@203.0.113.10:1080', expected(undefined, undefined, 'demo', '1234:part:tail')],
  ['Base64 userinfo numeric multi-colon password', `socks://${base64('demo:1234:part:tail')}@203.0.113.10:1080`, expected(undefined, undefined, 'demo', '1234:part:tail')],
  ['port lower boundary', '203.0.113.10:1', expected(undefined, 1)],
  ['port upper boundary', '203.0.113.10:65535', expected(undefined, 65535)],
  ...['p@ss', 'p://ss', 'pass:word:more', '100%40literal', 'p#?/\\&=+', ' 密码🙂 ', 'password  ', '123456', 'true', 'null'].flatMap(password => [
    [`colon password ${JSON.stringify(password)}`, `203.0.113.10:1080:u:${password}`, expected(undefined, undefined, 'u', password)],
    [`URI password ${JSON.stringify(password)}`, `socks5://u:${encodeURIComponent(password)}@203.0.113.10:1080`, expected(undefined, undefined, 'u', password)],
    [`encoded password ${JSON.stringify(password)}`, `socks://${base64(`u:${password}`)}@203.0.113.10:1080`, expected(undefined, undefined, 'u', password)],
  ]),
];
