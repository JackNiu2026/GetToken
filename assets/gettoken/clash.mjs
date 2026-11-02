import { buildSubscription, subscriptionImportLink } from './clash-config.mjs?v=clients-20261102';

const $ = id => document.getElementById(`clash-${id}`);
const form = $('form');
let yaml = '';
let subscription = null;
let busy = false;

function error(message = '') {
  $('error').textContent = message;
  $('error').hidden = !message;
  if (message) $('feedback').textContent = '';
}
function values() { return { source: $('source').value, name: $('name').value, udp: $('udp').checked, format: $('format').value }; }
function render() {
  error();
  $('feedback').textContent = '';
  if (!form.reportValidity()) return null;
  try {
    const data = values();
    const result = buildSubscription(data);
    yaml = result.yaml;
    $('yaml').textContent = yaml;
    $('output-title').textContent = result.format === 'shadowrocket' ? '小火箭配置' : 'Clash 配置';
    $('copy-yaml').disabled = false;
    $('count').textContent = `${result.count} 个节点`;
    $('count').classList.add('is-ready');
    $('source').removeAttribute('aria-invalid');
    return { data, result };
  } catch (e) {
    error(e.message);
    $('source').setAttribute('aria-invalid', 'true');
    $('source').focus();
    return null;
  }
}
async function request(path, options) {
  let response;
  try { response = await fetch(path, { ...options, cache: 'no-store', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(15000) }); }
  catch { throw new Error('订阅服务暂时无法连接，请稍后重试；你仍可下载 YAML 文件。'); }
  let data;
  try { data = await response.json(); } catch { throw new Error('订阅服务暂时不可用；请先下载 YAML 文件。'); }
  if (!response.ok) throw new Error(data.error || '操作失败，请稍后重试');
  return data;
}
function setBusy(value) {
  busy = value;
  $('fields').disabled = value;
  $('example').disabled = value;
  $('revoke').disabled = value;
  $('generate').textContent = value ? '正在生成…' : '生成订阅链接';
  form.setAttribute('aria-busy', String(value));
}
async function copy(value, target) {
  error();
  try {
    await navigator.clipboard.writeText(value);
    $('feedback').textContent = '已复制';
  } catch {
    if (target instanceof HTMLInputElement) { target.focus(); target.select(); }
    else { const range = document.createRange(); range.selectNodeContents(target); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); }
    error('自动复制未成功，内容已选中，请手动复制。');
  }
}
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (busy) return;
  const output = render();
  if (!output) return;
  setBusy(true);
  try {
    const data = await request('/api/clash/subscriptions', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-GetToken-Clash': '1' }, body: JSON.stringify(output.data) });
    // Keep the previous link's revoke control until the replacement has actually been created.
    const previous = subscription;
    subscription = data;
    const url = new URL(data.path, location.origin).href;
    $('url').value = url;
    $('url-label').textContent = data.format === 'shadowrocket' ? '小火箭订阅链接' : 'Clash 订阅链接';
    $('import').href = subscriptionImportLink(url, output.result.name, data.format);
    $('import').textContent = data.format === 'shadowrocket' ? '导入小火箭' : '导入 Clash Verge';
    $('expiry').textContent = `有效期至 ${new Date(data.expiresAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}（北京时间）。`;
    $('subscription').hidden = false;
    if (matchMedia('(max-width: 900px)').matches) $('subscription').scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    $('feedback').textContent = '订阅已生成，复制链接后即可导入。';
    if (previous) {
      try { await request(previous.path, { method: 'DELETE', headers: { 'X-GetToken-Clash-Manage': previous.manageToken } }); $('feedback').textContent += ' 本页的上一个链接已失效，请在客户端替换为新链接。'; }
      catch { $('feedback').textContent += ' 上一个链接未能撤销，将在到期后失效。'; }
    }
  } catch (e) { error(e.message); }
  finally { setBusy(false); }
});
$('download').addEventListener('click', () => {
  const output = render();
  if (!output) return;
  const url = URL.createObjectURL(new Blob([output.result.yaml], { type: 'text/yaml;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url; link.download = output.result.format === 'shadowrocket' ? 'gettoken-shadowrocket.yaml' : 'gettoken-clash.yaml'; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  $('feedback').textContent = output.result.format === 'shadowrocket' ? '小火箭节点配置已生成；远程订阅请使用“生成订阅链接”。' : 'YAML 文件已生成，请在 Clash Verge 中导入本地配置。';
});
$('copy-yaml').addEventListener('click', () => copy(yaml, $('yaml')));
$('copy-url').addEventListener('click', () => copy($('url').value, $('url')));
$('revoke').addEventListener('click', async () => {
  if (!subscription || busy) return;
  busy = true;
  $('fields').disabled = true;
  $('example').disabled = true;
  $('revoke').disabled = true;
  error();
  try {
    await request(subscription.path, { method: 'DELETE', headers: { 'X-GetToken-Clash-Manage': subscription.manageToken } });
    subscription = null; $('url').value = ''; $('import').removeAttribute('href'); $('subscription').hidden = true;
    $('feedback').textContent = '订阅链接已失效。客户端已下载的配置需在客户端手动删除。';
  } catch (e) { error(e.message); }
  finally { busy = false; $('fields').disabled = false; $('example').disabled = false; $('revoke').disabled = false; }
});
$('example').addEventListener('click', () => {
  if ($('source').value.trim()) { error('请先清空代理输入框，再填入示例。'); return; }
  $('source').value = 'socks5://demo:password@203.0.113.10:1080#示例节点\n203.0.113.20:1080:demo:password\n203.0.113.30:1080';
  $('source').focus(); error();
  $('feedback').textContent = '已填入文档保留地址，仅用于演示，不能用于实际连接。';
});
form.addEventListener('input', () => {
  error(); $('source').removeAttribute('aria-invalid');
  $('feedback').textContent = subscription ? '输入已修改。重新生成会替换本页上一个订阅链接。' : '';
  if (yaml) { $('count').textContent = '输入已修改，需重新转换'; $('count').classList.remove('is-ready'); $('copy-yaml').disabled = true; }
});
