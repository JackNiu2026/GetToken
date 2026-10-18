import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { ORDER_PATTERN } from '../assets/gettoken/verify-rules.mjs';
import { qqSupportContact, orderSupportVisible } from '../assets/gettoken/verify-support.mjs';

const source = await readFile(new URL('../assets/gettoken/verify.mjs', import.meta.url), 'utf8');
const startup = source.split('/* ---------- start ---------- */')[1].split('// A pasted link may change only the fragment')[0];
const id = 'GT-VF-1018-7KQ2AB';
async function startAt(address) {
  const requested = [], opened = [], remembered = [];
  const location = { href: address }, banner = {};
  const context = vm.createContext({
    URL, URLSearchParams, ORDER_PATTERN, Date, location,
    history: { replaceState(_, __, url) { location.href = String(url); } },
    recentOrders: () => [{ id, at: Date.now(), access: 'a'.repeat(43) }],
    remember: (...args) => remembered.push(args),
    renderRecent() {}, checkCode() {}, renderIntake() {},
    api: async path => { requested.push(path); return path === 'config' ? { intakeMode: 'external' } : { id, status: 'reviewing', external: { source: 'session' } }; },
    openOrder: (...args) => opened.push(args),
    showOrder: () => { throw new Error('History must not silently replace the main form'); },
    $: () => banner, loadFeed() {}, setInterval() {},
  });
  await vm.runInContext('let config = null;\n' + startup + '\nstart();', context);
  return { requested, opened, remembered, location };
}

test('normal navigation stays on the main form even with a recent active submission', async () => {
  const result = await startAt('https://gettoken.cc/verify/');
  assert.deepEqual(result.requested, ['config']);
  assert.deepEqual(result.opened, []);
  assert.deepEqual(result.remembered, []);
});

test('explicit private query links still open the requested submission and consume the access fragment', async () => {
  const access = 'b'.repeat(43);
  const result = await startAt(`https://gettoken.cc/verify/?order=${id}#access=${access}`);
  assert.equal(result.opened[0][0], id);
  assert.equal(result.remembered[0][0], id);
  assert.equal(result.remembered[0][1], access);
  assert.equal(new URL(result.location.href).hash, '');
});

test('support appears at the deadline and remains available for every completed result', () => {
  const dueAt = 1000000;
  assert.equal(orderSupportVisible({ status: 'reviewing', dueAt }, dueAt - 1), false);
  assert.equal(orderSupportVisible({ status: 'reviewing', dueAt }, dueAt), true);
  assert.equal(orderSupportVisible({ status: 'reviewing', dueAt }, dueAt + 1), true);
  for (const status of ['passed', 'failed', 'rejected', 'expired']) {
    assert.equal(orderSupportVisible({ status, dueAt }, dueAt - 1), true);
    assert.equal(orderSupportVisible({ status, dueAt }, dueAt + 1), true);
  }
  assert.equal(orderSupportVisible({ status: 'reviewing', dueAt: null }, dueAt), false);
  assert.equal(orderSupportVisible({ status: 'reviewing', dueAt: NaN }, dueAt), false);
  assert.equal(orderSupportVisible(null, dueAt), false);
});

test('QQ support destinations accept only account numbers and carry no private query data', () => {
  const contact = qqSupportContact('12345678');
  const url = new URL(contact.href);
  assert.equal(url.origin, 'https://wpa.qq.com');
  assert.equal(url.searchParams.get('uin'), '12345678');
  assert.deepEqual([...url.searchParams.keys()].sort(), ['menu', 'site', 'uin', 'v']);
  for (const invalid of ['', '00012345', 'javascript:alert(1)', '12345&access=private', 'https://untrusted.invalid/']) assert.equal(qqSupportContact(invalid), null);
});
