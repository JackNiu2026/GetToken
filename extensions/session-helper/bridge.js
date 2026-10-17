// Isolated extension world. Only a real click starts a request; messages from
// the webpage can discover availability, but cannot request cookies.
(() => {
  if (window !== window.top || location.origin !== 'https://gettoken.cc' || location.pathname !== '/verify/') return;
  const channel = 'gettoken-session-helper-v1';
  let pending = null;
  let starting = false;
  const notify = (state, extra = {}) => window.postMessage({ channel, state, ...extra }, location.origin);

  window.addEventListener('message', event => {
    if (event.source === window && event.origin === location.origin
      && event.data?.channel === channel && event.data?.state === 'ping') notify('ready');
  });
  notify('ready');

  document.addEventListener('click', async event => {
    const button = event.target instanceof Element && event.target.closest('[data-session-extract]');
    if (!event.isTrusted || !button || button.disabled || starting || pending) return;
    const field = document.querySelector('textarea[data-code]');
    if (!field || field.value.trim()) return notify('draft');
    starting = true;
    notify('starting');
    try {
      const result = await chrome.runtime.sendMessage({ type: 'start' });
      if (!result?.ok) return notify('error');
      pending = { id: result.id, expires: result.expires };
      notify('pending');
      setTimeout(() => {
        if (pending?.id === result.id) { pending = null; notify('expired'); }
      }, Math.max(0, result.expires - Date.now()) + 100);
    } catch { notify('error'); }
    finally { starting = false; }
  }, true);

  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || !pending || message.id !== pending.id || pending.expires <= Date.now()) return;
    if (message.type === 'check') { respond({ ok: true }); return; }
    if (message.type === 'cancelled') { pending = null; notify('cancelled'); respond({ ok: true }); return; }
    if (message.type !== 'fill') return;
    const field = document.querySelector('textarea[data-code]');
    const key = message.key;
    pending = null;
    if (!field || field.value.trim()) { notify('draft'); respond({ ok: false }); return; }
    if (typeof key !== 'string' || key.length < 40 || key.length > 4096 || !/^sk[A-Za-z0-9_-]+$/.test(key)) {
      notify('error'); respond({ ok: false }); return;
    }
    // Never place the credential in a DOM event, URL, clipboard or storage.
    field.value = key;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.focus();
    notify('filled');
    respond({ ok: true });
  });
})();
