// The page only receives status messages. The isolated extension bridge fills
// the textarea after an explicit confirmation in its own extension window.
export function initSessionHelper(root = document) {
  const helper = root.querySelector('[data-session-helper]');
  if (!helper || new URLSearchParams(location.search).get('helper') !== '1') return;
  const button = root.querySelector('[data-session-extract]');
  const status = root.querySelector('[data-session-status]');
  const guide = root.querySelector('[data-session-install]');
  const field = root.querySelector('[data-code]');
  if (!button || !status || !guide || !field) return;
  helper.hidden = false;
  const channel = 'gettoken-session-helper-v1';
  let installed = false, waiting = 0, timeout = 0;
  const show = text => { status.textContent = text; };
  const done = text => {
    clearTimeout(waiting); clearTimeout(timeout); button.disabled = false;
    button.textContent = '获取已登录的 Session Key'; show(text);
  };
  const busy = () => {
    clearTimeout(waiting); clearTimeout(timeout); guide.hidden = true;
    button.disabled = true; button.textContent = '请在扩展窗口确认授权';
    show('请确认读取来源和回填网站。回填后仍需你自行提交。');
    timeout = setTimeout(() => done('请求已过期，请再次获取。手动填写仍可使用。'), 120_500);
  };
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.channel !== channel) return;
    switch (event.data.state) {
      case 'ready': installed = true; guide.hidden = true; break;
      case 'starting': case 'pending': installed = true; busy(); break;
      case 'filled': done('已回填，请核对并确认授权后自行提交。读取成功不代表会话有效。'); break;
      case 'draft': done('输入框已有内容，未覆盖。请先核对，或清空后重新获取。'); break;
      case 'cancelled': done('已取消获取，你可以重新获取或手动填写。'); break;
      case 'expired': done('请求已过期，请再次点击获取。'); break;
      case 'error': done('无法连接助手，请检查扩展是否启用，刷新页面后重试。'); break;
    }
  });
  const ping = () => window.postMessage({ channel, state: 'ping' }, location.origin);
  ping();
  button.addEventListener('click', event => {
    if (!event.isTrusted) return;
    if (field.value.trim()) return done('输入框已有内容，未覆盖。请先核对，或清空后重新获取。');
    if (installed) { busy(); return; }
    ping();
    waiting = setTimeout(() => {
      if (installed) return;
      guide.hidden = false; guide.open = true;
      show('未检测到助手。请先安装，启用后刷新本页；也可继续手动填写。');
    }, 400);
  });
}
