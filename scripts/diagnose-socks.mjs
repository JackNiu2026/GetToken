// Operator-only, read-only diagnosis. This program never returns proxy credentials.
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = '/opt/gettoken/verify/current';
const hash = process.argv[2];
const expectedHost = process.argv[3];
const expectedPort = Number(process.argv[4]);
if (!/^[0-9a-f]{64}$/.test(hash || '') || !/^\d{1,3}(\.\d{1,3}){3}$/.test(expectedHost || '') || !Number.isInteger(expectedPort)) throw new Error('Invalid diagnostic selector');
const { loadConfig } = await import(pathToFileURL(join(root, 'server/verify/config.mjs')));
const { openCode } = await import(pathToFileURL(join(root, 'server/verify/secure.mjs')));
const config = loadConfig();
const db = new DatabaseSync(join(config.dataDir, 'verify.db'), { readOnly: true });
let row;
try { row = db.prepare('select config_sealed, expires_at, format from clash_subscriptions where token_hash = ?').get(hash); }
finally { db.close(); }
if (!row) { console.log('GETTOKEN_SOCKS_DIAGNOSTIC=' + JSON.stringify({ subscriptionFound: false })); process.exit(0); }
const yaml = openCode(config.secret, row.config_sealed);
const lines = yaml.split(/\r?\n/);
const start = lines.indexOf('proxies:');
if (start < 0) throw new Error('Unsupported configuration');
const nodes = [];
for (const line of lines.slice(start + 1)) {
  if (/^\S/.test(line)) break;
  if (line.startsWith('  - {')) { nodes.push(JSON.parse(line.slice(4))); continue; }
  if (line.startsWith('  - name: ')) { nodes.push({ name: JSON.parse(line.slice(10)) }); continue; }
  const match = /^    (type|server|port|username|password|udp): (.+)$/.exec(line);
  if (!match || !nodes.length) continue;
  nodes.at(-1)[match[1]] = match[1] === 'type' ? match[2] : JSON.parse(match[2]);
}
if (nodes.length !== 1 || nodes[0].server !== expectedHost || nodes[0].port !== expectedPort || nodes[0].type !== 'socks5') throw new Error('Endpoint does not match the authorized diagnostic target');
const node = nodes[0];
function redact(text) {
  for (const value of [node.username, node.password]) if (value) for (const form of [value, encodeURIComponent(value)]) text = text.split(form).join('[redacted]');
  return text.slice(0, 400);
}
function probe(url) {
  const auth = node.username ? `${encodeURIComponent(node.username)}:${encodeURIComponent(node.password)}@` : '';
  const proxy = `socks5h://${auth}${node.server}:${node.port}`;
  const input = [
    `proxy = ${JSON.stringify(proxy)}`, 'noproxy = ""', `url = ${JSON.stringify(url)}`,
    'silent', 'show-error', 'connect-timeout = 8', 'max-time = 15', 'output = "/dev/null"',
    'write-out = "%{http_code}|%{time_connect}|%{time_total}"', '',
  ].join('\n');
  const result = spawnSync('curl', ['--config', '-'], { input, encoding: 'utf8', timeout: 18000, maxBuffer: 64 * 1024 });
  const [http, connect, total] = String(result.stdout || '').split('|');
  return { target: new URL(url).hostname, ok: result.status === 0 && Number(http) >= 200 && Number(http) < 400,
    curlExit: result.status, httpStatus: Number(http) || 0, connectSeconds: Number(connect) || 0,
    totalSeconds: Number(total) || 0, error: redact(String(result.stderr || result.error?.code || '').trim()) };
}
const report = { subscriptionFound: true, expired: row.expires_at <= Date.now(), format: row.format,
  configuration: { nodes: nodes.length, endpointMatches: true, host: node.server, port: node.port, udp: node.udp,
    usernameBytes: Buffer.byteLength(node.username || ''), passwordBytes: Buffer.byteLength(node.password || '') },
  probes: [probe('https://example.com/'), probe('https://www.gstatic.com/generate_204')] };
console.log('GETTOKEN_SOCKS_DIAGNOSTIC=' + JSON.stringify(report));
