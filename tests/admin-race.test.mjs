import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Exercise the actual event handlers with controlled HTTP ordering. No network,
// production credentials or browser dependencies are required in CI.
const source = (await readFile(new URL('../assets/gettoken/verify-admin.mjs', import.meta.url), 'utf8'))
  .replace(/^import .*;$/m, 'const VERIFY = { auditFeeMinor: 30000 }; const yuan = n => String(n); const STATUS_NAMES = {}, REFUND_NAMES = {};')
  .replace('import.meta.url', '"https://local.test/assets/gettoken/verify-admin.mjs"')
  .replace(/start\(\)\.catch\(error => \{[\s\S]*$/, '');

function fixture() {
  const nodes = new Map(), requests = [];
  function node(selector) {
    if (!nodes.has(selector)) nodes.set(selector, {
      innerHTML: '', hidden: false, value: 'Synthetic audit evidence', dataset: {}, listeners: {},
      addEventListener(type, fn) { this.listeners[type] = fn; },
      querySelector: node, querySelectorAll: () => [],
      setAttribute() {}, focus() {}, classList: { add() {}, remove() {} },
    });
    return nodes.get(selector);
  }
  const context = vm.createContext({
    URL, URLSearchParams, Date, Set, String, Number, Math, encodeURIComponent,
    document: { querySelector: node, visibilityState: 'visible' },
    CSS: { escape: x => x }, window: { confirm: () => true },
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    fetch(url, options) {
      return new Promise(resolve => requests.push({ path: new URL(url).pathname, options,
        reply(data, status = 200) { resolve({ ok: status < 400, status, json: async () => data }); },
      }));
    },
  });
  vm.runInContext(source, context);
  const run = code => vm.runInContext(code, context);
  const order = id => ({ id, code: 'sk-synthetic-' + id, status: 'reviewing', refunds: [], payments: [], events: [] });
  const click = () => node('[data-detail]').listeners.click({ target: { closest: () => ({
    disabled: false, dataset: { decide: 'passed' }, hasAttribute: () => false,
  }) } });
  return { node, requests, run, order, click, context };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('late detail cannot replace selected order, including A → B → A', async () => {
  const f = fixture();
  const a1 = f.run('openDetail("A")'), b = f.run('openDetail("B")'), a2 = f.run('openDetail("A")');
  f.requests[2].reply({ ...f.order('A'), reason: 'newest' }); await a2;
  f.requests[1].reply(f.order('B')); await b;
  f.requests[0].reply({ ...f.order('A'), reason: 'obsolete' }); await a1;
  assert.match(f.node('[data-detail]').innerHTML, /newest/);
  assert.doesNotMatch(f.node('[data-detail]').innerHTML, /obsolete/);
  assert.equal(f.run('displayedOrder.id'), 'A');
});

test('loading and failure invalidate old actions; logout discards pending detail', async () => {
  const f = fixture();
  const a = f.run('openDetail("A")'); f.requests[0].reply(f.order('A')); await a;
  const b = f.run('openDetail("B")'); await f.click();
  assert.equal(f.requests.length, 2);
  f.requests[1].reply({ error: 'failed' }, 500); await b;
  await f.click(); assert.equal(f.requests.length, 2);
  const c = f.run('openDetail("C")'); f.run('showLogin()');
  f.requests[2].reply(f.order('C')); await c;
  assert.equal(f.node('[data-detail]').innerHTML, '');
  assert.equal(f.run('displayedOrder'), null);
});

test('decision binds displayed ID and cannot overwrite another order or submit twice', async () => {
  const f = fixture();
  const a = f.run('openDetail("A")'), b = f.run('openDetail("B")');
  f.requests[1].reply(f.order('B')); await b;
  f.requests[0].reply(f.order('A')); await a;
  const decision = f.click(); await f.click();
  assert.equal(f.requests.length, 3);
  assert.equal(f.requests[2].path, '/api/verify/admin/orders/B/decision');
  const c = f.run('openDetail("C")'); f.requests[3].reply(f.order('C')); await c;
  f.requests[2].reply({ ...f.order('B'), status: 'passed' }); await flush();
  assert.equal(f.run('displayedOrder.id'), 'C');
  f.requests[4].reply({}); f.requests[5].reply({ items: [], total: 0, size: 20 });
  await decision;
});

test('selection changed during confirmation prevents submission', async () => {
  const f = fixture();
  const a = f.run('openDetail("A")'); f.requests[0].reply(f.order('A')); await a;
  f.context.window.confirm = () => { f.run('openDetail("B")'); return true; };
  await f.click(); assert.equal(f.requests.length, 2);
  assert.ok(f.requests.every(r => r.options.method === 'GET'));
});

test('obsolete list response does not replace latest search results', async () => {
  const f = fixture();
  const old = f.run('loadList()'); f.run('state.q = "new"');
  const latest = f.run('loadList()');
  f.requests[1].reply({ items: [f.order('LATEST')], total: 1, size: 20 }); await latest;
  f.requests[0].reply({ items: [f.order('OBSOLETE')], total: 1, size: 20 }); await old;
  assert.match(f.node('[data-rows]').innerHTML, /LATEST/);
  assert.doesNotMatch(f.node('[data-rows]').innerHTML, /OBSOLETE/);
});


test('blank review explanation keeps focus on the field without posting a decision', async () => {
 const f=fixture();
 const detail=f.run('openDetail("A")');f.requests[0].reply(f.order('A'));await detail;
 f.node('[data-reason]').value='   ';
 await f.click();
 assert.equal(f.requests.length,1);
 assert.equal(f.node('[data-decision-error]').hidden,false);
 assert.match(f.node('[data-decision-error]').textContent,/填写审核说明/);
});
