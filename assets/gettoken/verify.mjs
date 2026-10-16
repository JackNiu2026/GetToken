// /verify/: submit a code, pay online, watch the review and read the result.
// Every status and result shown here comes from the API; the page never decides an outcome.
import { VERIFY, totalMinor, yuan, normalizeCode, codeProblem, ORDER_PATTERN, REFUND_NAMES, serviceDisclosure, serviceContractReady } from './verify-rules.mjs';
import { qrSvg } from './qr.mjs';

const API = new URL('../../api/verify/', import.meta.url);
const STORE_KEY = 'gettoken-verify-orders';
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const form = $('[data-form]');
const panel = $('[data-order]');
const codeField = $('[data-code]');
const codeState = $('[data-code-state]');
const codeCount = $('[data-code-count]');
const submit = $('[data-submit]');
const formError = $('[data-form-error]');
const channelBox = $('[data-channels]');

let config = null;
let current = null; // last order payload from the API
let shownKey = '';
let pollTimer = 0;
let tickTimer = 0;
let clockOffset = 0; // server time minus browser time
let lastChannel = null; // channel of the last QR code shown, reused when a new one is needed

/* ---------- helpers ---------- */
async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(new URL(path, API), {
      ...options,
      headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined,
      cache: 'no-store',
    });
  } catch {
    throw Object.assign(new Error('网络连接失败，请检查网络后重试'), { status: 0 });
  }
  let data = {};
  try { data = await response.json(); } catch { /* proxy error pages are not JSON */ }
  if (!response.ok) throw Object.assign(new Error(data.error || (response.status >= 500 ? '认证协助服务暂时无法连接，请稍后再试' : '请求失败，请稍后再试')), { status: response.status });
  return data;
}

const toast = $('[data-toast]');
let toastTimer = 0;
function showToast(message) {
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('is-shown');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('is-shown'), 2200);
}
async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(`已复制：${text}`);
  } catch {
    showToast('复制失败，请手动选择文字复制');
  }
}

const serverNow = () => Date.now() + clockOffset;
const pad = n => String(n).padStart(2, '0');
function stamp(ms) {
  const d = new Date(ms);
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function clock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}
function duration(ms) {
  const minutes = Math.max(1, Math.round(ms / 60000));
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 ? `${hours} 小时 ${minutes % 60} 分钟` : `${hours} 小时`;
}
function ago(ms, now) {
  const minutes = Math.floor((now - ms) / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} 小时前` : `${Math.floor(hours / 24)} 天前`;
}
const channelLabel = key => config?.channels.find(c => c.key === key)?.label || '在线支付';

/* ---------- recent orders (this browser only) ---------- */
function recentOrders() {
  try {
    const list = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
    return Array.isArray(list) ? list.filter(o => ORDER_PATTERN.test(o?.id)) : [];
  } catch {
    return [];
  }
}
function remember(id) {
  try {
    const list = [{ id, at: Date.now() }, ...recentOrders().filter(o => o.id !== id)].slice(0, 5);
    localStorage.setItem(STORE_KEY, JSON.stringify(list));
  } catch { /* storage may be blocked; the order number still works */ }
  renderRecent();
}
function renderRecent() {
  const box = $('[data-recent]');
  const list = recentOrders();
  box.hidden = !list.length;
  box.innerHTML = list.map(o => `<li><a href="?order=${esc(o.id)}" data-open-order="${esc(o.id)}">${esc(o.id)}</a><span>${esc(stamp(o.at))} 提交</span></li>`).join('');
}

/* ---------- form ---------- */
function checkCode(final = false) {
  const code = normalizeCode(codeField.value);
  codeCount.textContent = `${code.length} 位`;
  const problem = code ? codeProblem(code) : null;
  const showProblem = problem && (final || code.length >= VERIFY.codeMin || !code.startsWith('sk'));
  codeState.textContent = !code ? '' : showProblem ? problem : problem ? '' : '✓ 仅格式通过，未验证凭据有效性';
  codeState.className = showProblem ? 'is-bad' : problem ? '' : 'is-ok';
  codeField.setAttribute('aria-invalid', String(!!showProblem));
  return { code, problem: code ? problem : codeProblem('') };
}
codeField.addEventListener('input', () => checkCode());
codeField.addEventListener('blur', () => { if (codeField.value) checkCode(true); });

function setFormError(message) {
  formError.hidden = !message;
  formError.textContent = message || '';
}

const canSubmit = () => config?.acceptingOrders === true && config.channels?.length > 0
  && (config.mode === 'mock' || serviceContractReady(config.serviceContract));
function renderChannels() {
  const open = canSubmit();
  codeField.disabled = !open;
  $('[data-agree]').disabled = !open;
  $('[data-show-public]').disabled = !open;
  if (!open) { codeField.value = ''; checkCode(); }
  const stateLabel = $('[data-service-state]');
  if (stateLabel) stateLabel.textContent = `Claude KYC认证 · ${open ? '人工协助' : '暂未受理'}`;
  const terms = $('[data-service-disclosure]');
  if (terms) terms.textContent = config?.mode === 'mock'
    ? '本地测试流程：仅使用虚构凭据，不会真实扣款或完成官方认证。'
    : serviceDisclosure(config?.serviceContract);

  if (!config) {
    channelBox.innerHTML = '<p class="v-hint">认证协助服务暂时无法连接，请稍后刷新页面。</p>';
    submit.disabled = true;
    return;
  }
  if (!open) {
    channelBox.innerHTML = '<p class="v-hint">当前暂停新订单，请勿输入会话凭据或付款。已有订单仍可查询，历史收款和退款继续处理。</p>';
    submit.disabled = true;
    submit.textContent = '暂未受理';
    return;
  }
  submit.textContent = `付款并提交认证协助 · ${yuan(totalMinor())}`;
  channelBox.innerHTML = config.channels.map((c, i) => `<label class="v-channel"><input type="radio" name="channel" value="${esc(c.key)}"${i === 0 ? ' checked' : ''}><span>${esc(c.label)}</span></label>`).join('');
  submit.disabled = false;
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  setFormError('');
  if (!canSubmit()) return setFormError('当前不受理新订单，请勿输入会话凭据或付款');
  const { code, problem } = checkCode(true);
  if (problem) {
    setFormError(problem);
    codeField.focus();
    return;
  }
  if (!$('[data-agree]').checked) {
    setFormError('请先勾选，确认账户归属、访问授权及费用与退款规则');
    $('[data-agree]').focus();
    return;
  }
  const channel = $('input[name="channel"]:checked', form)?.value;
  if (!channel) return setFormError('请选择付款方式');
  submit.disabled = true;
  submit.textContent = '正在生成付款二维码…';
  try {
    const order = await api('orders', { method: 'POST', body: { code, agree: true, showPublic: $('[data-show-public]').checked, channel } });
    remember(order.id);
    form.reset();
    checkCode();
    showOrder(order, { scroll: true });
  } catch (error) {
    setFormError(error.message);
  } finally {
    renderChannels();
  }
});

/* ---------- order panel ---------- */
const TRACK = ['已提交', '付款', '处理中', '出结果'];
const track = step => `<ol class="v-track" aria-label="进度">${TRACK.map((name, i) => `<li class="${i < step ? 'is-done' : i === step ? 'is-now' : ''}">${name}</li>`).join('')}</ol>`;
const top = (order, tag) => `<div class="v-order__top"><span class="v-mono">订单 ${esc(order.id)}</span>${tag}</div>`;
const CHECK = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7"/></svg>';
const CROSS = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>';
const ownRef = order => `<div class="v-ref"><div><span>订单号（凭它查询进度）</span><b>${esc(order.id)}</b></div><button class="v-btn v-btn--ghost v-btn--sm" type="button" data-copy="${esc(order.id)}">复制</button></div>`;
const again = (label = '提交新的认证协助') => `<button class="v-btn v-btn--ghost" type="button" data-new>${label}</button>`;

function unpaidView(order) {
  const p = order.payment;
  const expired = !p || p.expiresAt <= serverNow();
  const channel = p?.channel || (config?.channels.some(c => c.key === lastChannel) ? lastChannel : config?.channels[0]?.key);
  const tabs = (config?.channels.length || 0) > 1
    ? `<div class="v-pay__tabs" aria-label="换一种付款方式">${config.channels.map(c => `<button type="button" data-switch="${esc(c.key)}" aria-pressed="${c.key === channel}">${esc(c.label)}</button>`).join('')}</div>` : '';
  const qr = p ? qrSvg(p.qr, { label: `${channelLabel(p.channel)}付款二维码` }) : '';
  const mobile = p && !expired && p.channel === 'alipay' && /^https:\/\//.test(p.qr)
    ? `<a class="v-btn v-btn--light v-btn--sm v-pay__open" href="${esc(p.qr)}" rel="noopener">在手机上？打开支付宝付款</a>`
    : p?.channel === 'wechat' ? '<p class="v-hint" style="margin-top:10px">微信付款需要用另一部设备扫描这个二维码；只有这一部手机时，请换成支付宝。</p>' : '';
  return `${top(order, '<span class="v-tag v-tag--amber">待付款</span>')}
<h2>扫码付款 ${yuan(order.fees.total)}</h2>
<p class="v-sub">请用${esc(channelLabel(channel))}扫码。到账后本页自动更新，开始本站 ${VERIFY.reviewHours} 小时预计处理计时。</p>
${track(1)}
<div class="v-pay">
<div class="v-qr${expired ? ' v-qr--expired' : ''}">${qr}</div>
<div class="v-pay__side">
<dl class="v-kv"><div><dt>人工技术费（不退）</dt><dd>${yuan(order.fees.tech)}</dd></div><div><dt>审核费（未通过退）</dt><dd>${yuan(order.fees.audit)}</dd></div><div class="is-total"><dt>合计</dt><dd>${yuan(order.fees.total)}</dd></div></dl>
${tabs}${mobile}
<p class="v-hint" style="margin-top:10px" data-expiry>${expired ? '二维码已过期，请重新获取。' : ''}</p>
</div></div>
${ownRef(order)}
<div class="v-acts">${expired ? (channel ? `<button class="v-btn v-btn--light" type="button" data-renew="${esc(channel)}">重新获取二维码</button>` : '') : '<button class="v-btn v-btn--light" type="button" data-refresh>我已付款，刷新状态</button>'}${again('更换 Session Key')}</div>`;
}

function reviewingView(order) {
  return `${top(order, '<span class="v-tag v-tag--violet">处理中</span>')}
${track(2)}
<div class="v-ring" data-ring><svg viewBox="0 0 232 232" aria-hidden="true"><defs><linearGradient id="v-ring-grad"><stop offset="0" stop-color="#8b5cf6"/><stop offset="1" stop-color="#ec4899"/></linearGradient></defs><circle class="v-ring__track" cx="116" cy="116" r="104"/><circle class="v-ring__bar" cx="116" cy="116" r="104" data-ring-bar/></svg><div class="v-ring__text"><b class="v-num" data-ring-time>--:--:--</b><span data-ring-label>预计剩余时间</span></div></div>
<p class="v-sub v-center" style="margin-top:10px" data-ring-note>正在处理认证协助订单，本站结果录入后自动更新</p>
<dl class="v-kv"><div><dt>Session Key</dt><dd class="v-mono">${esc(order.code)}</dd></div><div><dt>付款时间</dt><dd class="v-num">${esc(stamp(order.paidAt))}</dd></div><div><dt>预计出结果</dt><dd class="v-num">${esc(stamp(order.dueAt))} 前</dd></div></dl>
${ownRef(order)}
<p class="v-note">关闭页面不影响本站处理。可凭订单号查询；官方认证状态请在 Claude 账户内核对。</p>
<div class="v-acts">${again('提交另一个 Session Key')}</div>`;
}

function confetti() {
  if (reduceMotion.matches) return '';
  const colors = ['#4ee0b0', '#c4a3ff', '#fbbf24', '#7aa7ff', '#ec4899'];
  return `<div class="v-confetti" aria-hidden="true">${Array.from({ length: 14 }, (_, i) => `<i style="left:${(i % 2 ? 66 : 6) + ((i * 37) % 28)}%;top:${10 + ((i * 23) % 90)}px;background:${colors[i % colors.length]};transform:rotate(${(i * 47) % 180}deg);animation-delay:${(i % 5) * 80}ms"></i>`).join('')}</div>`;
}

function passedView(order) {
  return `<div class="v-result">${top(order, '<span class="v-tag v-tag--green">处理通过</span>')}${confetti()}
<div class="v-badge v-badge--ok">${CHECK}</div>
<h2 style="margin-top:16px">本站认证协助处理通过</h2>
<p class="v-sub">${esc(stamp(order.decidedAt))} 已录入本站结果，官方认证状态请在 Claude 内核对。${order.reason ? `交付说明：${esc(order.reason)}。` : ''}如与约定不符，请保留订单和脱敏证据联系支持方，不要重复付款。</p>
${track(4)}
<dl class="v-kv"><div><dt>Session Key</dt><dd class="v-mono">${esc(order.code)}</dd></div><div><dt>处理用时</dt><dd>${esc(duration(order.decidedAt - order.paidAt))}</dd></div><div><dt>费用</dt><dd>${yuan(order.fees.total)}（已完成）</dd></div></dl>
${ownRef(order)}
<div class="v-acts">${again('返回服务说明')}</div></div>`;
}

function failedView(order) {
  const refund = order.refund || {};
  const done = refund.status === 'success';
  const refundLine = done
    ? `${esc(stamp(refund.refundedAt))} 已原路退回，请在付款账户查看`
    : `${VERIFY.refundHours} 小时内原路退回 · ${esc(stamp(refund.dueAt))} 前`;
  return `<div class="v-result">${top(order, '<span class="v-tag v-tag--rose">未通过</span>')}
<div class="v-badge v-badge--no">${CROSS}</div>
<h2 style="margin-top:16px">本站认证协助未通过</h2>
<p class="v-sub">${esc(stamp(order.decidedAt))} 已录入本站结果，审核费按原规则退回。请先查看原因与原付款账户；退款超时或异常时联系支持方跟进，无需重复购买。</p>
${order.reason ? `<p class="v-reason"><b>未通过原因</b>${esc(order.reason)}</p>` : ''}
<div class="v-refund">
<div class="v-refund__row"><b>审核费 <span class="v-tag ${done ? 'v-tag--green' : 'v-tag--amber'}">${esc(REFUND_NAMES[refund.status] || '退款中')}</span></b><span>${refundLine}</span><strong>${yuan(refund.amount ?? order.fees.audit)}</strong></div>
<div class="v-refund__row"><b>人工技术费 <span class="v-tag v-tag--rose">不退</span></b><span>人工核对与认证协助已处理</span><strong>${yuan(order.fees.tech)}</strong></div>
</div>
${ownRef(order)}
<div class="v-acts">${again('返回服务说明')}</div></div>`;
}

function expiredView(order) {
  return `${top(order, '<span class="v-tag v-tag--gray">已过期</span>')}
<h2>订单已过期</h2><p class="v-sub">这个订单在 24 小时内没有完成付款，已自动关闭，没有产生费用。</p>
<div class="v-acts">${again('返回服务说明')}</div>`;
}

const VIEWS = { unpaid: unpaidView, reviewing: reviewingView, passed: passedView, failed: failedView, expired: expiredView };

// Redraws the panel only when what it shows has changed (status, QR code, expiry, refund).
function render(order) {
  const key = JSON.stringify([order.status, order.payment?.id, order.payment && order.payment.expiresAt <= serverNow(), order.refund?.status]);
  if (key !== shownKey || panel.hidden) {
    shownKey = key;
    panel.innerHTML = VIEWS[order.status](order);
  }
}

// Shows an order fresh from the API; the server time it carries keeps the countdown honest.
function showOrder(order, { scroll = false } = {}) {
  current = order;
  clockOffset = order.now - Date.now();
  if (order.payment) lastChannel = order.payment.channel;
  render(order);
  form.hidden = true;
  panel.hidden = false;
  const address = new URL(location.href);
  if (address.searchParams.get('order') !== order.id) {
    address.searchParams.set('order', order.id);
    history.replaceState(null, '', address);
  }
  if (scroll) panel.scrollIntoView({ behavior: reduceMotion.matches ? 'auto' : 'smooth', block: 'start' });
  tick();
  schedulePoll();
}

function closeOrder() {
  clearTimeout(pollTimer);
  current = null;
  shownKey = '';
  panel.hidden = true;
  panel.innerHTML = '';
  form.hidden = false;
  const address = new URL(location.href);
  address.searchParams.delete('order');
  history.replaceState(null, '', address);
  form.scrollIntoView({ behavior: reduceMotion.matches ? 'auto' : 'smooth', block: 'start' });
  codeField.focus({ preventScroll: true });
}

// Countdown and QR expiry, once a second.
function tick() {
  clearTimeout(tickTimer);
  if (!current) return;
  const now = serverNow();
  if (current.status === 'reviewing') {
    const total = current.dueAt - current.paidAt;
    const left = current.dueAt - now;
    const late = left <= 0;
    const ring = $('[data-ring]', panel);
    const bar = $('[data-ring-bar]', panel);
    if (ring && bar) {
      const length = 2 * Math.PI * 104;
      const progress = late ? 1 : Math.min(1, Math.max(0, (now - current.paidAt) / total));
      bar.setAttribute('stroke-dasharray', `${(length * progress).toFixed(1)} ${length.toFixed(1)}`);
      ring.classList.toggle('v-ring--late', late);
      $('[data-ring-time]', panel).textContent = clock(left);
      $('[data-ring-label]', panel).textContent = late ? '比预计稍久' : '预计剩余时间';
      $('[data-ring-note]', panel).textContent = late ? '仍在处理本站订单，结果录入后本页自动更新' : '正在处理认证协助订单，本站结果录入后自动更新';
    }
  }
  if (current.status === 'unpaid' && current.payment) {
    const left = current.payment.expiresAt - now;
    const note = $('[data-expiry]', panel);
    if (left <= 0) render(current); // switches to the expired view once; polling carries on
    else if (note) note.textContent = `二维码 ${clock(left).slice(3)} 后过期`;
  }
  tickTimer = setTimeout(tick, 1000);
}

function schedulePoll() {
  clearTimeout(pollTimer);
  if (!current || !['unpaid', 'reviewing'].includes(current.status) && !(current.status === 'failed' && current.refund?.status !== 'success')) return;
  const hidden = document.visibilityState === 'hidden';
  const qrLive = current.payment && current.payment.expiresAt > serverNow();
  const delay = current.status === 'unpaid' ? (hidden || !qrLive ? 15000 : 3000) : (hidden ? 120000 : 30000);
  pollTimer = setTimeout(refresh, delay);
}

async function refresh() {
  if (!current) return;
  try {
    const order = await api(`orders/${encodeURIComponent(current.id)}${current.payment ? `?channel=${encodeURIComponent(current.payment.channel)}` : ''}`);
    if (current && order.id === current.id) showOrder(order);
  } catch {
    schedulePoll();
  }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && current) refresh(); });

panel.addEventListener('click', async event => {
  const target = event.target.closest('button');
  if (!target || !current) return;
  if (target.dataset.copy) return copy(target.dataset.copy);
  if (target.hasAttribute('data-new')) return closeOrder();
  if (target.hasAttribute('data-refresh')) {
    target.disabled = true;
    await refresh();
    if (current?.status === 'unpaid') showToast('还没有收到付款，到账后会自动更新');
    target.disabled = false;
    return;
  }
  const channel = target.dataset.switch || target.dataset.renew;
  if (channel) {
    if (target.dataset.switch && current.payment?.channel === channel && current.payment.expiresAt > serverNow()) return;
    target.disabled = true;
    try {
      const order = await api(`orders/${encodeURIComponent(current.id)}/payments`, { method: 'POST', body: { channel } });
      shownKey = '';
      showOrder(order);
    } catch (error) {
      showToast(error.message);
      target.disabled = false;
    }
  }
});

// The header button and any other #submit link return to the form while an order is open.
document.addEventListener('click', event => {
  const link = event.target.closest('a[href="#submit"]');
  if (!link || !form.hidden) return;
  event.preventDefault();
  closeOrder();
});

/* ---------- lookup ---------- */
const queryForm = $('[data-query]');
const queryError = $('[data-query-error]');
async function openOrder(raw, { scroll = true, quiet = false } = {}) {
  const id = String(raw || '').trim().toUpperCase();
  queryError.hidden = true;
  if (!ORDER_PATTERN.test(id)) {
    if (!quiet) { queryError.textContent = '订单号格式不正确，例如 GT-VF-1014-7KQ2AB'; queryError.hidden = false; }
    return;
  }
  try {
    const order = await api(`orders/${encodeURIComponent(id)}`);
    remember(order.id);
    shownKey = '';
    showOrder(order, { scroll });
  } catch (error) {
    if (!quiet) { queryError.textContent = error.message; queryError.hidden = false; }
  }
}
queryForm.addEventListener('submit', event => {
  event.preventDefault();
  openOrder(new FormData(queryForm).get('order'));
});
$('[data-recent]').addEventListener('click', event => {
  const link = event.target.closest('[data-open-order]');
  if (!link) return;
  event.preventDefault();
  openOrder(link.dataset.openOrder);
});

/* ---------- marquee of passed reviews ---------- */
const feedWin = $('[data-feed-win]');
const feedList = $('[data-feed-list]');
async function loadFeed() {
  try {
    const data = await api('feed');
    $('[data-stat="processed"]').textContent = data.today.processed;
    $('[data-stat="passed"]').textContent = data.today.passed;
    const item = (row, hidden) => `<li class="v-feed__item"${hidden ? ' aria-hidden="true"' : ''}><span class="v-feed__ok">${CHECK}</span><div><b>${esc(row.code)}</b><span>本站处理通过</span></div><time datetime="${new Date(row.at).toISOString()}">${esc(ago(row.at, data.now))}</time></li>`;
    const rolling = data.items.length >= 5;
    feedWin.classList.toggle('is-rolling', rolling);
    feedWin.style.setProperty('--v-roll', `${data.items.length * 3}s`);
    feedList.innerHTML = data.items.length
      ? data.items.map(row => item(row, false)).join('') + (rolling ? data.items.map(row => item(row, true)).join('') : '')
      : '<li class="v-feed__empty">还没有公开的通过记录。</li>';
  } catch {
    feedList.innerHTML = '<li class="v-feed__empty">暂时无法获取最新通过记录。</li>';
  }
}

/* ---------- start ---------- */
async function start() {
  renderRecent();
  checkCode();
  try {
    config = await api('config');
  } catch {
    config = null;
  }
  renderChannels();
  const banner = $('[data-mode-banner]');
  if (config?.mode === 'mock') {
    banner.textContent = '测试模式：不会真实扣款或完成官方认证，后台模拟收款后进入本站处理流程。';
    banner.hidden = false;
  }
  const fromUrl = new URL(location.href).searchParams.get('order');
  if (fromUrl) openOrder(fromUrl, { scroll: true });
  else {
    // Reopen the latest unfinished order from this browser.
    const latest = recentOrders()[0];
    if (latest && Date.now() - latest.at < 3 * 86400_000) {
      try {
        const order = await api(`orders/${encodeURIComponent(latest.id)}`);
        if (order.status === 'unpaid' || order.status === 'reviewing') showOrder(order);
      } catch { /* the order list still offers it */ }
    }
  }
  loadFeed();
  setInterval(loadFeed, 60000);
}
start();
