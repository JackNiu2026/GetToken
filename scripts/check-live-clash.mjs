#!/usr/bin/env node
// Production acceptance creates one synthetic subscription and revokes it immediately.
// It never uses an actual user's proxy credentials or prints bearer URLs.
import assert from 'node:assert/strict';
import { SITE } from '../content/site.mjs';
import { buildSubscription } from '../assets/gettoken/clash-config.mjs';

const baseArgument = process.argv.indexOf('--base');
const origin = new URL(baseArgument >= 0 ? process.argv[baseArgument + 1] : SITE.origin);
assert.ok(origin.protocol === 'https:' || (origin.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(origin.hostname)), 'Use HTTPS or a local preview');
const request = (path, options = {}) => fetch(new URL(path, origin), { ...options, redirect: 'error', signal: AbortSignal.timeout(15000) });
const page = await request('/clash/');
assert.equal(page.status, 200, 'Subscription conversion page must be available');
const html = await page.text();
for (const type of ['desktop-nav', 'mobile-nav']) {
  const nav = html.match(new RegExp(`<nav class="${type}"[\\s\\S]*?</nav>`))?.[0] || '';
  assert.match(nav, />订阅转换<\/a>/, 'Both navigation menus must include the converter');
  assert.doesNotMatch(nav, />住宅IP<\/a>/, 'The former residential IP navigation item must be replaced');
}
for (const format of ['clash', 'shadowrocket']) {
const input = { source: 'socks5://smoke:test%40password@203.0.113.10:1080#部署验证\nsocks5h://[2001:db8::1]:1080\n203.0.113.20:1080:user:p@ss:word%40\nsocks://ZGVtbzoxMjM0OnBhcnQ6dGFpbEAyMDMuMC4xMTMuMTA6MTA4MA==', name: '部署验证（示例地址）', udp: false, format };
const created = await request('/api/clash/subscriptions', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-GetToken-Clash': '1' }, body: JSON.stringify(input) });
assert.equal(created.status, 201, 'Subscription API must create a private link');
const subscription = await created.json();
assert.match(subscription.path || '', /^\/api\/clash\/subscriptions\/[\w-]{43}$/);
assert.match(subscription.manageToken || '', /^[\w-]{43}$/);
assert.equal(subscription.format, format);
assert.equal(subscription.count, 4);
try {
  const response = await request(subscription.path);
  assert.equal(response.status, 200, 'The generated URL must return a configuration');
  assert.match(response.headers.get('content-type') || '', /yaml/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(await response.text(), buildSubscription(input).yaml, 'The client must receive the complete generated YAML');
} finally {
  const revoked = await request(subscription.path, { method: 'DELETE', headers: { 'X-GetToken-Clash-Manage': subscription.manageToken } });
  assert.equal(revoked.status, 200, 'The synthetic subscription must be revoked');
}
assert.equal((await request(subscription.path)).status, 404, 'Revoked links must stop serving credentials');
console.log(`Production ${format} conversion verified: mixed SOCKS5 formats, IPv6, YAML payload, navigation and revocation. Synthetic documentation IPs only; subscription removed.`);
}
