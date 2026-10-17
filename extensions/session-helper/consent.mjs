const id = new URL(location.href).searchParams.get('request');
const agree = document.querySelector('#agree'), read = document.querySelector('#read');
const status = document.querySelector('#status'), open = document.querySelector('#open');
let ready = false, busy = false;
const render = () => { read.disabled = !ready || !agree.checked || busy; };
const errors = {
  expired: '请求已过期或来源页面已关闭。请返回 GetToken，再次点击获取按钮。',
  denied: '请求来源不受支持，请从 https://gettoken.cc/verify/ 的获取按钮开始。',
  permission: '未获得 Claude Cookie 访问授权。可再次点击授权，或返回网页手动填写。',
  profile: '无法读取当前浏览器资料。请在普通窗口中使用同一浏览器账号重试。',
  missing: '当前浏览器资料中未找到 sessionKey。请打开 Claude 检查是否已登录，再点击重试。',
  format: '读取的会话格式与当前提交规则不符，请手动核对，不要重复提交。',
  draft: '输入框已有内容，本次没有覆盖。请返回网页核对，或清空后重新获取。',
  unavailable: '暂时无法回填。请保持 GetToken 页面打开，刷新后重新获取。',
};
agree.addEventListener('change', render);
document.querySelector('#cancel').addEventListener('click', () => window.close());
open.addEventListener('click', () => chrome.tabs.create({ url: 'https://claude.ai/' }));
read.addEventListener('click', async event => {
  if (!event.isTrusted || !ready || !agree.checked || busy) return;
  busy = true; render(); open.hidden = true; status.textContent = '正在读取当前浏览器的登录会话…';
  try {
    // Must run directly in this user gesture; this browser prompt is never bypassed.
    const granted = await chrome.permissions.request({ origins: ['https://claude.ai/*'] });
    if (!granted) { status.textContent = errors.permission; return; }
    const result = await chrome.runtime.sendMessage({ type: 'read', id });
    if (result?.ok) { status.textContent = '已回填，请返回网页核对并自行提交。'; ready = false; window.close(); return; }
    const error = result?.error || 'unavailable';
    status.textContent = errors[error] || errors.unavailable;
    if (['expired', 'denied', 'draft'].includes(error)) ready = false;
    open.hidden = error !== 'missing';
  } catch { status.textContent = errors.unavailable; }
  finally { busy = false; render(); }
});
try {
  const result = await chrome.runtime.sendMessage({ type: 'context', id });
  ready = result?.ok === true;
  status.textContent = ready ? '请确认授权。本次请求在 2 分钟后失效。' : errors[result?.error] || errors.expired;
  if (ready) setTimeout(() => { ready = false; render(); status.textContent = errors.expired; }, Math.max(0, result.expires - Date.now()));
} catch { status.textContent = errors.unavailable; }
render();
