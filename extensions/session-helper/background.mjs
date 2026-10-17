import { PAGE, CLAUDE, TTL, PREFIX, allowedSender, usableKey, currentRequest } from './policy.mjs';

const requestKey = id => PREFIX + id;
const consentPage = sender => {
  try { return sender?.id === chrome.runtime.id && new URL(sender.url).href.split('?')[0] === chrome.runtime.getURL('consent.html'); }
  catch { return false; }
};
async function getRequest(id) {
  if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) throw Error('expired');
  const value = (await chrome.storage.session.get(requestKey(id)))[requestKey(id)];
  if (!currentRequest(value)) { await chrome.storage.session.remove(requestKey(id)); throw Error('expired'); }
  return value;
}
async function deliver(request, message) {
  return chrome.tabs.sendMessage(request.tabId, { ...message, id: request.id }, { documentId: request.documentId });
}
async function start(sender) {
  if (!allowedSender(sender, chrome.runtime.id)) throw Error('denied');
  // Only non-secret consent metadata is persisted across service-worker suspension.
  const previous = await chrome.storage.session.get(null);
  for (const [key, request] of Object.entries(previous)) {
    if (!key.startsWith(PREFIX)) continue;
    if (!currentRequest(request)) { await chrome.storage.session.remove(key); continue; }
    if (request.tabId === sender.tab.id) {
      try { await chrome.windows.remove(request.windowId); } catch { /* already closed */ }
      await chrome.storage.session.remove(key);
    }
  }
  const request = { id: crypto.randomUUID(), tabId: sender.tab.id, documentId: sender.documentId, expires: Date.now() + TTL };
  await chrome.storage.session.set({ [requestKey(request.id)]: request });
  try {
    const window = await chrome.windows.create({ url: chrome.runtime.getURL('consent.html') + '?request=' + request.id, type: 'popup', width: 520, height: 680, focused: true });
    request.windowId = window.id;
    await chrome.storage.session.set({ [requestKey(request.id)]: request });
  } catch (error) { await chrome.storage.session.remove(requestKey(request.id)); throw error; }
  return { ok: true, id: request.id, expires: request.expires };
}
async function handle(message, sender) {
  if (message?.type === 'start') return start(sender);
  if (!consentPage(sender)) throw Error('denied');
  const request = await getRequest(message.id);
  if (message.type === 'context') return { ok: true, target: PAGE, expires: request.expires };
  if (message.type !== 'read') throw Error('denied');
  try {
    if (!(await deliver(request, { type: 'check' }))?.ok) throw Error('expired');
  } catch { throw Error('expired'); }
  if (!await chrome.permissions.contains({ origins: [CLAUDE + '*'] })) throw Error('permission');
  // Select the cookie store belonging to the requesting tab, never another profile.
  const stores = await chrome.cookies.getAllCookieStores();
  const store = stores.find(item => item.tabIds.includes(request.tabId));
  if (!store) throw Error('profile');
  const cookie = await chrome.cookies.get({ url: CLAUDE, name: 'sessionKey', storeId: store.id });
  if (!cookie?.value) throw Error('missing');
  if (!usableKey(cookie.value)) throw Error('format');
  // A request may have expired or been cancelled while a browser API was pending.
  await getRequest(request.id);
  const result = await deliver(request, { type: 'fill', key: cookie.value });
  await chrome.storage.session.remove(requestKey(request.id));
  if (!result?.ok) throw Error('draft');
  try {
    await chrome.tabs.update(request.tabId, { active: true });
    const tab = await chrome.tabs.get(request.tabId);
    await chrome.windows.update(tab.windowId, { focused: true });
  } catch { /* A successful fill is not undone by focus restrictions. */ }
  return { ok: true };
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  handle(message, sender).then(respond).catch(error => respond({ ok: false,
    error: ['expired', 'denied', 'permission', 'profile', 'missing', 'format', 'draft'].includes(error.message) ? error.message : 'unavailable' }));
  return true;
});
chrome.windows.onRemoved.addListener(async windowId => {
  const entries = await chrome.storage.session.get(null);
  for (const [key, request] of Object.entries(entries)) {
    if (!key.startsWith(PREFIX) || request.windowId !== windowId) continue;
    await chrome.storage.session.remove(key);
    try { await deliver(request, { type: 'cancelled' }); } catch { /* source tab closed/navigated */ }
  }
});
