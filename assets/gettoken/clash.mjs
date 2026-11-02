import { buildSubscription, subscriptionImportLink } from './clash-config.mjs?v=chain-pool-20261103';

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
function values() { return { source: $('source').value, name: $('name').value, udp: $('udp').checked, format: $('format').value, routing: $('format').value === 'clash' ? $('routing').value : 'all', connection: $('format').value === 'clash' ? $('connection').value : 'direct', upstreamUrl: $('format').value === 'clash' && $('connection').value === 'chain' ? $('upstream').value : '' }; }
function render() {
  error();
  $('feedback').textContent = '';
  if (!form.reportValidity()) return null;
  try {
    const data = values();
    const result = buildSubscription(data);
    yaml = result.yaml;
    $('yaml').textContent = yaml;
    $('output-title').textContent = result.format === 'shadowrocket' ? '小火箭配置' : result.connection === 'chain' ? 'Clash 组链节点配置' : 'Clash 配置';
    $('copy-yaml').disabled = false;
    $('count').textContent = result.connection === 'chain' ? `${result.count} 个住宅 + 前置订阅` : `${result.count} 个节点`;
    $('count').classList.add('is-ready');
    $('source').removeAttribute('aria-invalid');
    return { data, result };
  } catch (e) {
    error(e.message);
    const target = /^(前置订阅|请填写供应商)/.test(e.message) ? $('upstream') : $('source');
    target.setAttribute('aria-invalid', 'true');
    target.focus();
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
    nextStep('remote', data.format, output.result.connection);
    $('feedback').textContent = '订阅已生成，尚未测试代理连通性。';
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
  nextStep('local', output.result.format, output.result.connection);
  $('feedback').textContent = output.result.format === 'shadowrocket' ? '小火箭节点配置已生成；远程订阅请使用“生成订阅链接”。' : 'YAML 文件已生成，尚未测试代理连通性。';
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
  $('next-step').hidden = true;
  error(); $('source').removeAttribute('aria-invalid'); $('upstream').removeAttribute('aria-invalid');
  $('feedback').textContent = subscription ? '输入已修改。重新生成会替换本页上一个订阅链接。' : '';
  if (yaml) { $('count').textContent = '输入已修改，需重新转换'; $('count').classList.remove('is-ready'); $('copy-yaml').disabled = true; }
});

function nextStep(method, format, connection) {
  $('next-step').hidden = false;
  const local = method === 'local';
  $('next-title').textContent = format === 'shadowrocket' ? '下一步：在小火箭中导入节点订阅' : local ? '下一步：在 Clash Verge 中新建本地配置' : '下一步：在 Clash Verge 中导入订阅';
  $('next-detail').textContent = format === 'shadowrocket'
    ? '使用“生成订阅链接”，在小火箭添加 Subscribe / 订阅并粘贴链接；选择节点后连接，路由沿用小火箭设置。'
    : local
      ? '订阅 → 新建 → Local（本地）→ 导入下载的 YAML → 保存并选中配置 → PROXY 选择节点 → 开启系统代理。'
      : '复制上方 HTTPS 链接 → 订阅页粘贴并导入 → 选中配置 → PROXY 选择节点 → 开启系统代理。';
  if (connection === 'chain') $('next-detail').textContent = (local ? '订阅 → 新建 Local（本地）→ 导入下载的 YAML 并选中配置。' : '复制上方 HTTPS 链接 → 订阅页粘贴并导入 → 选中配置。') + ' 等待前置订阅加载，“链式节点”组会同时显示前置和住宅节点。点击客户端“链式代理”，按“前置 → 住宅 SOCKS5”的顺序添加并保存，再开启系统代理。仅选中单个节点不会形成代理链。';
}
function updateClient() {
  const shadowrocket = $('format').value === 'shadowrocket';
  $('connection-options').hidden = shadowrocket;
  $('connection').disabled = shadowrocket;
  updateConnection();
  $('routing-options').hidden = shadowrocket;
  $('routing').disabled = shadowrocket;
  $('download').textContent = shadowrocket ? '下载节点 YAML' : '下载 YAML，本地导入';
}
$('format').addEventListener('change', updateClient);
updateClient();

function updateConnection() {
  const chained = $('format').value === 'clash' && $('connection').value === 'chain';
  $('routing').options[0].textContent = chained ? '全部交给“链式节点”组（默认）' : '全部交给 PROXY 分组（默认）';
  $('routing').options[1].textContent = chained ? '局域网及中国大陆 IP 直连，其余交给“链式节点”' : '局域网及中国大陆 IP 直连，其余走 PROXY';
  $('upstream-fields').hidden = !chained;
  $('upstream').disabled = !chained;
  $('upstream').required = chained;
  $('chain-path').textContent = chained ? '同组展示前置与住宅节点，导入后通过客户端“链式代理”手动选择先后顺序。' : '直连由本机连接 SOCKS5。入口需要中转时，选择链式代理。';
}
$('connection').addEventListener('change', updateConnection);
