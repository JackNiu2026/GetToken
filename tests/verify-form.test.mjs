import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import * as rules from '../assets/gettoken/verify-rules.mjs';

const source = await readFile(new URL('../assets/gettoken/verify.mjs', import.meta.url), 'utf8');
const formCode = source.split('/* ---------- form ---------- */')[1].split('/* ---------- order panel ---------- */')[0];
const html = await readFile(new URL('../verify/index.html', import.meta.url), 'utf8');
function fixture(config) {
  const nodes = new Map(), requests = [];
  function node(selector) {
    if (!nodes.has(selector)) nodes.set(selector, {
      value: '', checked: false, disabled: false, listeners: {},
      addEventListener(type, fn) { this.listeners[type] = fn; },
      setAttribute() {}, focus() {},
    });
    return nodes.get(selector);
  }
  const context = vm.createContext({
    ...rules, config, requests, crypto: webcrypto, TextEncoder, Uint8Array,
    $: node,
    referenceField: node('[data-external-reference]'),
    form: node('[data-form]'), codeField: node('[data-code]'), codeState: node('[data-code-state]'),
    codeCount: node('[data-code-count]'), submit: node('[data-submit]'), formError: node('[data-form-error]'),
    esc: x => String(x), api: async (path, options) => { requests.push({ path, ...options }); throw new Error('Synthetic submission failure'); },
  });
  vm.runInContext(formCode, context);
  node('[data-code]').value = 'sk-' + 'a'.repeat(45);
  node('[data-external-reference]').value = '1234567890123456789';
  node('[data-agree]').checked = true;
  node('[data-show-public]').checked = true;
  const run = code => vm.runInContext(code, context);
  return { node, run, requests, context,
    submit: () => node('[data-form]').listeners.submit({ preventDefault() {} }) };
}

test('static form permits typing and selecting before config or JavaScript loads', () => {
  for (const marker of ['data-code', 'data-external-reference', 'data-agree', 'data-show-public']) {
    const tag = html.match(new RegExp('<(?:textarea|input)[^>]*\\b' + marker + '\\b[^>]*>'))?.[0];
    assert.ok(tag, marker); assert.doesNotMatch(tag, /\bdisabled\b|\breadonly\b/);
  }
  assert.doesNotMatch(html, /name="channel"|data-channels|data-pay-qr|data-renew/);
  assert.match(html, /data-external-reference/);
});
for (const [name, config] of [['off', { mode: 'off', acceptingOrders: false, channels: [] }], ['unavailable', null]]) {
  test(`${name}: local controls and drafts survive rendering; submission sends nothing`, async () => {
    const f = fixture(config); f.run('renderIntake()');
    for (const selector of ['[data-code]', '[data-external-reference]', '[data-agree]', '[data-show-public]']) assert.equal(f.node(selector).disabled, false);
    assert.equal(f.node('[data-code]').value, 'sk-' + 'a'.repeat(45));
    assert.equal(f.node('[data-agree]').checked, true);
    assert.equal(f.node('[data-submit]').disabled, true);
    await f.submit(); assert.equal(f.requests.length, 0);
  });
}
test('late config and failed submission preserve Session Key, Taobao reference and consent', async () => {
  const f = fixture(null); f.run('renderIntake()');
  f.context.config = { mode: 'off', intakeMode: 'external', acceptingOrders: true, channels: [] };
  f.run('renderIntake()'); assert.equal(f.node('[data-submit]').disabled, false);
  await f.submit();
  assert.equal(f.requests.length, 1); assert.equal(f.requests[0].body.source, 'taobao');
  assert.equal(f.requests[0].body.reference, '1234567890123456789');
  assert.equal(f.node('[data-external-reference]').value, '1234567890123456789');
  assert.equal(f.node('[data-code]').value, 'sk-' + 'a'.repeat(45));
  assert.equal(f.node('[data-agree]').checked, true);
  assert.equal(f.node('[data-show-public]').checked, true);
  assert.equal(f.node('[data-form-error]').textContent, 'Synthetic submission failure');
  assert.equal(f.node('[data-submit]').disabled, false);
});

test('invalid Taobao reference and missing consent keep drafts and do not submit', async () => {
  const f = fixture({ mode: 'off', intakeMode: 'external', acceptingOrders: true });
  f.node('[data-external-reference]').value = 'invalid'; await f.submit();
  assert.equal(f.requests.length, 0); assert.match(f.node('[data-form-error]').textContent, /淘宝订单号/);
  f.node('[data-external-reference]').value = '1234567890123456789'; f.node('[data-agree]').checked = false;
  await f.submit(); assert.equal(f.requests.length, 0); assert.match(f.node('[data-form-error]').textContent, /授权/);
});
