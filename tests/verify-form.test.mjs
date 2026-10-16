import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as rules from '../assets/gettoken/verify-rules.mjs';

const source = await readFile(new URL('../assets/gettoken/verify.mjs', import.meta.url), 'utf8');
const formCode = source.split('/* ---------- form ---------- */')[1].split('/* ---------- order panel ---------- */')[0];
const html = await readFile(new URL('../verify/index.html', import.meta.url), 'utf8');
const channels = [{ key: 'wechat', label: '微信支付' }, { key: 'alipay', label: '支付宝' }];
function fixture(config) {
  const nodes = new Map(), requests = [];
  let selected = 'alipay';
  function node(selector) {
    if (!nodes.has(selector)) nodes.set(selector, {
      value: '', checked: false, disabled: false, listeners: {},
      addEventListener(type, fn) { this.listeners[type] = fn; },
      setAttribute() {}, focus() {},
    });
    return nodes.get(selector);
  }
  const channelBox = node('[data-channels]');
  Object.defineProperty(channelBox, 'innerHTML', {
    get() { return this.markup || ''; },
    set(value) { this.markup = value; selected = value.match(/value="([^"]+)" checked/)?.[1]; },
  });
  const context = vm.createContext({
    ...rules, config, requests, channelBox,
    $: selector => selector === 'input[name="channel"]:checked' ? { value: selected } : node(selector),
    form: node('[data-form]'), codeField: node('[data-code]'), codeState: node('[data-code-state]'),
    codeCount: node('[data-code-count]'), submit: node('[data-submit]'), formError: node('[data-form-error]'),
    esc: x => String(x), api: async (path, options) => { requests.push({ path, ...options }); throw new Error('Synthetic payment failure'); },
  });
  vm.runInContext(formCode, context);
  node('[data-code]').value = 'sk-' + 'a'.repeat(45);
  node('[data-agree]').checked = true;
  node('[data-show-public]').checked = true;
  const run = code => vm.runInContext(code, context);
  return { node, run, requests, context, selected: () => selected,
    submit: () => node('[data-form]').listeners.submit({ preventDefault() {} }) };
}

test('static form permits typing and selecting before config or JavaScript loads', () => {
  for (const marker of ['data-code', 'data-agree', 'data-show-public']) {
    const tag = html.match(new RegExp('<(?:textarea|input)[^>]*\\b' + marker + '\\b[^>]*>'))?.[0];
    assert.ok(tag, marker); assert.doesNotMatch(tag, /\bdisabled\b|\breadonly\b/);
  }
  assert.match(html, /name="channel" value="wechat" checked/);
  assert.match(html, /name="channel" value="alipay"/);
});
for (const [name, config] of [['off', { mode: 'off', acceptingOrders: false, channels: [] }], ['unavailable', null]]) {
  test(`${name}: local controls and drafts survive rendering; submission sends nothing`, async () => {
    const f = fixture(config); f.run('renderChannels()');
    for (const selector of ['[data-code]', '[data-agree]', '[data-show-public]']) assert.equal(f.node(selector).disabled, false);
    assert.equal(f.node('[data-code]').value, 'sk-' + 'a'.repeat(45));
    assert.equal(f.node('[data-agree]').checked, true);
    assert.equal(f.selected(), 'alipay'); assert.equal(f.node('[data-submit]').disabled, true);
    await f.submit(); assert.equal(f.requests.length, 0);
  });
}
test('late config and failed payment preserve fields and selected payment channel', async () => {
  const f = fixture(null); f.run('renderChannels()');
  f.context.config = { mode: 'mock', acceptingOrders: true, channels };
  f.run('renderChannels()'); assert.equal(f.node('[data-submit]').disabled, false);
  await f.submit();
  assert.equal(f.requests.length, 1); assert.equal(f.requests[0].body.channel, 'alipay');
  assert.equal(f.node('[data-code]').value, 'sk-' + 'a'.repeat(45));
  assert.equal(f.node('[data-agree]').checked, true);
  assert.equal(f.node('[data-show-public]').checked, true);
  assert.equal(f.selected(), 'alipay');
  assert.equal(f.node('[data-form-error]').textContent, 'Synthetic payment failure');
  assert.equal(f.node('[data-submit]').disabled, false);
});
