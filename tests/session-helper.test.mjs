import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';
import { allowedPage, allowedSender, currentRequest, TTL } from '../extensions/session-helper/policy.mjs';

const extensionId = 'synthetic-extension-id';
const source = { id: extensionId, frameId: 0, tab: { id: 12, incognito: false }, documentId: 'original-document', url: 'https://gettoken.cc/verify/' };
const extension = { id: extensionId, url: `chrome-extension://${extensionId}/consent.html?request=synthetic` };
let listener, removed, state;
globalThis.crypto ??= webcrypto;
globalThis.chrome = {
  runtime: { id: extensionId, getURL: path => `chrome-extension://${extensionId}/${path}`, onMessage: { addListener: fn => { listener = fn; } } },
  storage: { session: {
    get: async key => key === null ? structuredClone(state.storage) : { [key]: structuredClone(state.storage[key]) },
    set: async values => Object.assign(state.storage, structuredClone(values)),
    remove: async key => { delete state.storage[key]; },
  } },
  windows: { create: async () => ({ id: 33 }), remove: async () => {}, update: async () => {}, onRemoved: { addListener: fn => { removed = fn; } } },
  tabs: {
    sendMessage: async (tabId, message, options) => {
      state.messages.push({ tabId, message, options });
      if (!state.live) throw Error('Receiving end does not exist');
      return { ok: state.accept };
    },
    update: async () => {}, get: async () => ({ windowId: 44 }),
  },
  permissions: { contains: async () => state.permission },
  cookies: {
    getAllCookieStores: async () => [{ id: 'unrelated', tabIds: [3] }, { id: 'same-profile', tabIds: [12] }],
    get: async query => { state.reads.push(query); return state.cookie ? { value: state.cookie } : null; },
  },
};
await import('../extensions/session-helper/background.mjs');
const call = (message, sender = source) => new Promise(resolve => listener(message, sender, resolve));
function reset() {
  state = { storage: {}, reads: [], messages: [], permission: true, cookie: 'sk-ant-sid01-' + 'synthetic'.repeat(8), live: true, accept: true };
}

test('helper restricts origin, document, normal profile and top frame', () => {
  assert.ok(allowedPage('https://gettoken.cc/verify/?order=example#fragment'));
  for (const url of ['http://gettoken.cc/verify/', 'https://gettoken.cc.evil.test/verify/', 'https://gettoken.cc/verify/admin/', 'https://gettoken.cc/verify', 'https://www.gettoken.cc/verify/', 'https://user@gettoken.cc/verify/']) assert.equal(allowedPage(url), false, url);
  assert.ok(allowedSender(source, extensionId));
  for (const change of [{ id: 'other' }, { frameId: 1 }, { documentId: undefined }, { tab: { id: 12, incognito: true } }, { url: 'https://other.test/verify/' }]) assert.equal(allowedSender({ ...source, ...change }, extensionId), false);
  const request = { id: 'example', tabId: 12, documentId: 'document', expires: 1000 + TTL };
  assert.ok(currentRequest(request, 1000));
  assert.equal(currentRequest(request, request.expires), false);
  assert.equal(currentRequest({ ...request, expires: Infinity }, 1000), false);
});

test('webpage requests and installation never read cookies; extension consent is required', async () => {
  reset();
  assert.equal((await call({ type: 'start' }, { ...source, frameId: 1 })).ok, false);
  const request = await call({ type: 'start' });
  assert.ok(request.ok); assert.equal(state.reads.length, 0);
  const denied = await call({ type: 'read', id: request.id });
  assert.equal(denied.error, 'denied'); assert.equal(state.reads.length, 0);
  const context = await call({ type: 'context', id: request.id }, extension);
  assert.equal(context.target, source.url); assert.ok(!JSON.stringify(context).includes(state.cookie));
  assert.ok(!JSON.stringify(state.storage).includes(state.cookie));
});

test('consented fill reads only the named cookie in the source profile, binds the document and returns no secret', async () => {
  reset(); const request = await call({ type: 'start' });
  const result = await call({ type: 'read', id: request.id }, extension);
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(state.reads, [{ url: 'https://claude.ai/', name: 'sessionKey', storeId: 'same-profile' }]);
  const fill = state.messages.find(item => item.message.type === 'fill');
  assert.equal(fill.tabId, 12); assert.equal(fill.options.documentId, source.documentId);
  assert.equal(fill.message.key, state.cookie);
  assert.deepEqual(state.storage, {});
  assert.ok(!JSON.stringify(result).includes(state.cookie));
  assert.equal((await call({ type: 'read', id: request.id }, extension)).error, 'expired');
  assert.equal(state.reads.length, 1);
});

test('denied host permission, expired consent and source navigation never read a credential', async () => {
  for (const scenario of ['permission', 'expired', 'navigated']) {
    reset(); const request = await call({ type: 'start' });
    if (scenario === 'permission') state.permission = false;
    if (scenario === 'expired') state.storage['request:' + request.id].expires = Date.now() - 1;
    if (scenario === 'navigated') state.live = false;
    assert.equal((await call({ type: 'read', id: request.id }, extension)).ok, false, scenario);
    assert.equal(state.reads.length, 0, scenario);
    assert.equal(state.messages.filter(item => item.message.type === 'fill').length, 0, scenario);
  }
});

test('missing or changed cookie yields a recoverable error without a fill or persisted secret', async () => {
  for (const [cookie, error] of [[null, 'missing'], ['invalid', 'format']]) {
    reset(); state.cookie = cookie; const request = await call({ type: 'start' });
    assert.equal((await call({ type: 'read', id: request.id }, extension)).error, error);
    assert.equal(state.messages.filter(item => item.message.type === 'fill').length, 0);
    assert.ok(!JSON.stringify(state.storage).includes('sk-ant'));
  }
});

test('closing consent invalidates its request; a later draft cannot be silently overwritten', async () => {
  reset(); const first = await call({ type: 'start' }); await removed(33);
  assert.equal((await call({ type: 'read', id: first.id }, extension)).error, 'expired');
  assert.equal(state.reads.length, 0);
  reset(); const second = await call({ type: 'start' });
  // Source page accepted the availability check, then refused a fill because the
  // user typed while the extension confirmation was open.
  const original = chrome.tabs.sendMessage;
  chrome.tabs.sendMessage = async (...args) => { state.accept = args[1].type !== 'fill'; return original(...args); };
  try { assert.equal((await call({ type: 'read', id: second.id }, extension)).error, 'draft'); }
  finally { chrome.tabs.sendMessage = original; }
  assert.deepEqual(state.storage, {});
});

test('download matches reviewed source and exposes only necessary extension capabilities', async () => {
  execFileSync('python3', ['scripts/package-session-helper.py', '--check']);
  const manifest = JSON.parse(await readFile(new URL('../extensions/session-helper/manifest.json', import.meta.url), 'utf8'));
  assert.deepEqual(manifest.permissions, ['cookies', 'storage']);
  assert.deepEqual(manifest.optional_host_permissions, ['https://claude.ai/*']);
  assert.deepEqual(manifest.content_scripts[0].matches, ['https://gettoken.cc/verify/', 'https://gettoken.cc/verify/?*']);
  assert.equal(manifest.incognito, 'not_allowed');
  assert.equal(manifest.externally_connectable, undefined);
  assert.match(manifest.content_security_policy.extension_pages, /connect-src 'none'/);
});

const consentSource = await readFile(new URL('../extensions/session-helper/consent.mjs', import.meta.url), 'utf8');
async function consentFixture(granted) {
  const nodes = new Map(), calls = [];
  const node = selector => {
    if (!nodes.has(selector)) nodes.set(selector, { checked: false, disabled: false, listeners: {}, addEventListener(type, fn) { this.listeners[type] = fn; } });
    return nodes.get(selector);
  };
  const context = {
    URL, location: { href: `chrome-extension://${extensionId}/consent.html?request=example` },
    document: { querySelector: node }, setTimeout() {}, window: { close() {} },
    chrome: {
      runtime: { sendMessage: async message => { calls.push(message); return { ok: true, expires: Date.now() + TTL }; } },
      permissions: { request: async details => { calls.push({ permission: details }); return granted; } },
      tabs: { create() {} },
    },
  };
  await vm.runInNewContext('(async () => {\n' + consentSource + '\n})()', context);
  return { node, calls };
}

test('extension UI requires a trusted click, its own consent and native permission before reading', async () => {
  const denied = await consentFixture(false);
  assert.equal(denied.node('#read').disabled, true);
  await denied.node('#read').listeners.click({ isTrusted: true });
  assert.equal(denied.calls.length, 1); // context only, no consent
  denied.node('#agree').checked = true; denied.node('#agree').listeners.change();
  assert.equal(denied.node('#read').disabled, false);
  await denied.node('#read').listeners.click({ isTrusted: false });
  assert.equal(denied.calls.length, 1);
  await denied.node('#read').listeners.click({ isTrusted: true });
  assert.equal(denied.calls.length, 2); // native permission was denied, no read
  assert.match(denied.node('#status').textContent, /未获得/);
  const granted = await consentFixture(true);
  granted.node('#agree').checked = true; granted.node('#agree').listeners.change();
  await granted.node('#read').listeners.click({ isTrusted: true });
  assert.equal(granted.calls.filter(call => call.type === 'read').length, 1);
});
