// /verify/: submit a Session Key, then privately query manual processing.
// Every status and result shown here comes from the API; the page never decides an outcome.
import { VERIFY, yuan, normalizeCode, codeProblem, ORDER_PATTERN, REFUND_NAMES } from './verify-rules.mjs?v=key-only-20261017';
import { initSessionHelper } from './verify-session-helper.mjs?v=helper-20261017';

const API = new URL('../../api/verify/', import.meta.url);
const STORE_KEY = 'gettoken-verify-orders';
const $ = (selector, root = document) => root.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const form = $('[data-form]');
const panel = $('[data-order]');
const codeField = $('[data-code]');
const codeState = $('[data-code-state]');
const codeCount = $('[data-code-count]');
const submit = $('[data-submit]');
const formError = $('[data-form-error]');
initSessionHelper();

let config = null;
let current = null; // last order payload from the API
let shownKey = '';
let pollTimer = 0;
let tickTimer = 0;
let clockOffset = 0; // server time minus browser time
const accessKeys = new Map(recentOrders().filter(o => /^[A-Za-z0-9_-]{43}$/.test(o.access || '')).map(o => [o.id, o.access]));
let lookupVersion = 0;

/* ---------- helpers ---------- */
async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(new URL(path, API), {
      ...options,
      headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(path.match(/^orders\/([^/?]+)/) && accessKeys.has(path.split('/')[1].split('?')[0])
          ? { 'X-GetToken-Order-Access': accessKeys.get(path.split('/')[1].split('?')[0]) } : {}) },
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
    showToast(ORDER_PATTERN.test(text) ? '受理编号已复制，可在原浏览器查询' : '查询链接已复制，请私密保存');
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

/* ---------- recent orders (this browser only) ---------- */
function recentOrders() {
  try {
    const list = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
    return Array.isArray(list) ? list.filter(o => ORDER_PATTERN.test(o?.id)) : [];
  } catch {
    return [];
  }
}
function remember(id, access, referenceHash) {
  if (/^[A-Za-z0-9_-]{43}$/.test(access || '')) accessKeys.set(id, access);
  try {
    const previous = recentOrders().find(o => o.id === id);
    const list = [{ id, access: accessKeys.get(id), referenceHash: referenceHash || previous?.referenceHash, at: Date.now() }, ...recentOrders().filter(o => o.id !== id)].slice(0, 5);
    localStorage.setItem(STORE_KEY, JSON.stringify(list));
  } catch { /* Memory still works; save the private query link before closing. */ }
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

// Fields remain editable while the server loads; only submission is gated.
const canSubmit = () => config?.intakeMode === 'external' && config.submissionMode === 'session-key' && config.acceptingOrders === true;
async function referenceDigest(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), n => n.toString(16).padStart(2, '0')).join('');
}
function renderIntake() {
  const ready = canSubmit();
  const stateLabel = $('[data-service-state]');
  if (stateLabel) stateLabel.textContent = 'Claude KYC认证 · Session Key 提交';
  submit.disabled = !ready;
  submit.textContent = ready ? '提交资料并获取查询链接' : config ? '暂不可提交，请稍后重试' : '服务连接失败，请刷新重试';
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  setFormError('');
  if (!canSubmit()) return setFormError('暂时无法提交资料，填写内容已保留，请稍后重试');
  const { code, problem } = checkCode(true);
  if (problem) {
    setFormError(problem);
    codeField.focus();
    return;
  }
  if (!$('[data-agree]').checked) {
    setFormError('请先确认账户归属与资料提交授权');
    $('[data-agree]').focus();
    return;
  }
  submit.disabled = true;
  submit.textContent = '正在提交资料…';
  try {
    const order = await api('orders', { method: 'POST', body: { code, agree: true, showPublic: $('[data-show-public]').checked, source: 'session' } });
    remember(order.id, order.accessToken);
    form.reset();
    checkCode();
    showOrder(order, { scroll: true });
  } catch (error) {
    setFormError(error.message);
  } finally {
    renderIntake();
  }
});

/* ---------- order panel ---------- */
const TRACK = ['已提交', '已受理', '处理中', '出结果'];
const track = step => `<ol class="v-track" aria-label="进度">${TRACK.map((name, i) => `<li class="${i < step ? 'is-done' : i === step ? 'is-now' : ''}">${name}</li>`).join('')}</ol>`;
const top = (order, tag) => `<div class="v-order__top"><span class="v-mono">受理编号 ${esc(order.id)}</span>${tag}</div>`;
const CHECK = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7"/></svg>';
const CROSS = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>';
const queryLink = id => { const url = new URL('/verify/', location.origin); url.searchParams.set('order', id); url.hash = `access=${accessKeys.get(id) || ''}`; return url.href; };
const ownRef = order => `<div class="v-ref"><div><span>受理编号 · <a href="${esc(queryLink(order.id))}" data-private-link>跨设备私密查询链接</a></span><b>${esc(order.id)}</b></div><button class="v-btn v-btn--ghost v-btn--sm" type="button" data-copy="${esc(order.id)}">复制受理编号</button></div>`;
const again = (label = '提交新的认证协助') => `<button class="v-btn v-btn--ghost" type="button" data-new>${label}</button>`;

function unpaidView(order) {
  return `${top(order, '<span class="v-tag v-tag--gray">历史订单</span>')}<h2>站内支付已隐藏</h2><p class="v-sub">此历史订单尚未确认付款。请联系支持方核对，不要重复购买。</p>${ownRef(order)}<div class="v-acts">${again('提交 Session Key')}</div>`;
}
function externalView(order) {
  const rejected = order.status === 'rejected';
  return `${top(order, `<span class="v-tag v-tag--${rejected ? 'rose' : 'amber'}">${rejected ? '核单未通过' : '待人工核单'}</span>`)}
<h2>${rejected ? '请核对淘宝订单资料' : '资料已收到'}</h2>
<p class="v-sub">${rejected ? esc(order.reason || '请联系支持方核实订单后再处理。') : '淘宝订单号待人工核对。提交成功不代表已确认付款；核单通过后才开始处理计时。'}</p>
<dl class="v-kv"><div><dt>淘宝订单</dt><dd>${esc(order.external?.reference)}</dd></div><div><dt>Session Key</dt><dd class="v-mono">${esc(order.code)}</dd></div><div><dt>提交时间</dt><dd>${esc(stamp(order.createdAt))}</dd></div></dl>
${ownRef(order)}<div class="v-acts"><button class="v-btn v-btn--light" type="button" data-refresh>刷新处理状态</button>${again('返回提交表单')}</div>`;
}

function reviewingView(order) {
  return `${top(order, '<span class="v-tag v-tag--violet">处理中</span>')}
${track(2)}
<div class="v-ring" data-ring><svg viewBox="0 0 232 232" aria-hidden="true"><defs><linearGradient id="v-ring-grad"><stop offset="0" stop-color="#8b5cf6"/><stop offset="1" stop-color="#ec4899"/></linearGradient></defs><circle class="v-ring__track" cx="116" cy="116" r="104"/><circle class="v-ring__bar" cx="116" cy="116" r="104" data-ring-bar/></svg><div class="v-ring__text"><b class="v-num" data-ring-time>--:--:--</b><span data-ring-label>预计剩余时间</span></div></div>
<p class="v-sub v-center" style="margin-top:10px" data-ring-note>正在处理认证协助订单，本站结果录入后自动更新</p>
<dl class="v-kv"><div><dt>Session Key</dt><dd class="v-mono">${esc(order.code)}</dd></div><div><dt>${order.external?.source === 'session' ? '提交时间' : order.external ? '核单时间' : '付款时间'}</dt><dd class="v-num">${esc(stamp(order.paidAt))}</dd></div><div><dt>预计出结果</dt><dd class="v-num">${esc(stamp(order.dueAt))} 前</dd></div></dl>
${ownRef(order)}
<p class="v-note">关闭页面不影响本站处理。请保存私密查询链接；官方认证状态请在 Claude 账户内核对。</p>
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
<p class="v-sub">${esc(stamp(order.decidedAt))} 已录入本站结果，官方认证状态请在 Claude 内核对。${order.reason ? `交付说明：${esc(order.reason)}。` : ''}如与约定不符，请保留订单和脱敏证据联系支持方，不要重复提交。</p>
${track(4)}
<dl class="v-kv"><div><dt>Session Key</dt><dd class="v-mono">${esc(order.code)}</dd></div><div><dt>处理用时</dt><dd>${esc(duration(order.decidedAt - order.paidAt))}</dd></div>${order.external?.source === 'session' ? '' : `<div><dt>费用</dt><dd>${order.external ? '以原订单约定为准' : yuan(order.fees.total) + '（已完成）'}</dd></div>`}</dl>
${ownRef(order)}
<div class="v-acts">${again('返回服务说明')}</div></div>`;
}

function failedView(order) {
  const refund = order.refund || {};
  const done = refund.status === 'success';
  const refundLine = order.external
    ? done ? '商家已登记退款，请在淘宝原订单核实到账；有疑问请联系商家。' : '请通过淘宝原订单联系商家处理，本站不会自动发起退款。'
    : done
    ? `${esc(stamp(refund.refundedAt))} 已原路退回，请在付款账户查看`
    : `${VERIFY.refundHours} 小时内原路退回 · ${esc(stamp(refund.dueAt))} 前`;
  return `<div class="v-result">${top(order, '<span class="v-tag v-tag--rose">未通过</span>')}
<div class="v-badge v-badge--no">${CROSS}</div>
<h2 style="margin-top:16px">本站认证协助未通过</h2>
<p class="v-sub">${esc(stamp(order.decidedAt))} 已录入本站结果，请查看未通过原因。</p>
${order.reason ? `<p class="v-reason"><b>未通过原因</b>${esc(order.reason)}</p>` : ''}
${order.external?.source === 'session' ? '' : order.external ? `<div class="v-refund"><div class="v-refund__row"><b>淘宝售后 <span class="v-tag ${done ? 'v-tag--green' : 'v-tag--amber'}">${done ? '商家已登记' : '待商家处理'}</span></b><span>${refundLine}</span></div></div>` : `<div class="v-refund">
<div class="v-refund__row"><b>审核费</b><span>${refundLine}</span><strong>${yuan(refund.amount ?? order.fees.audit)}</strong></div>
<div class="v-refund__row"><b>人工技术费</b><span>历史订单约定</span><strong>${yuan(order.fees.tech)}</strong></div></div>`}
${ownRef(order)}
<div class="v-acts">${again('返回服务说明')}</div></div>`;
}

function expiredView(order) {
  return `${top(order, '<span class="v-tag v-tag--gray">已过期</span>')}
<h2>订单已过期</h2><p class="v-sub">这个订单在 24 小时内没有完成付款，已自动关闭，没有产生费用。</p>
<div class="v-acts">${again('返回服务说明')}</div>`;
}

const VIEWS = { submitted: externalView, rejected: externalView, unpaid: unpaidView, reviewing: reviewingView, passed: passedView, failed: failedView, expired: expiredView };

// Redraws the panel only when what it shows has changed (status, QR code, expiry, refund).
function render(order) {
  const key = JSON.stringify([order.status, order.payment?.id, order.payment && order.payment.expiresAt <= serverNow(), order.refund?.status, order.reason, order.external]);
  if (key !== shownKey || panel.hidden) {
    shownKey = key;
    panel.innerHTML = VIEWS[order.status](order);
  }
}

// Shows an order fresh from the API; the server time it carries keeps the countdown honest.
function showOrder(order, { scroll = false } = {}) {
  current = order;
  clockOffset = order.now - Date.now();
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
  lookupVersion++;
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

// Processing countdown, once a second.
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
  tickTimer = setTimeout(tick, 1000);
}

function schedulePoll() {
  clearTimeout(pollTimer);
  if (!current || !['submitted', 'unpaid', 'reviewing'].includes(current.status) && !(current.status === 'failed' && current.refund?.status && current.refund.status !== 'success')) return;
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
    if (current?.status === 'submitted') showToast('仍待人工核单，请稍后查询');
    target.disabled = false;
    return;
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
  const version = ++lookupVersion;
  let input = String(raw || '').trim();
  if (/^https?:\/\//i.test(input)) {
    try {
      const link = new URL(input);
      if (link.origin !== location.origin || link.pathname !== '/verify/') throw new Error();
      input = link.searchParams.get('order') || '';
      const access = new URLSearchParams(link.hash.slice(1)).get('access');
      if (ORDER_PATTERN.test(input.toUpperCase()) && /^[A-Za-z0-9_-]{43}$/.test(access || '')) accessKeys.set(input.toUpperCase(), access);
    } catch { input = ''; }
  }
  if (/^\d{10,32}$/.test(input)) {
    const hash = await referenceDigest(input);
    if (version !== lookupVersion) return;
    input = recentOrders().find(o => o.referenceHash === hash)?.id || '';
  }
  const id = input.toUpperCase();
  queryError.hidden = true;
  if (!ORDER_PATTERN.test(id)) {
    if (!quiet) { queryError.textContent = '请使用本浏览器已保存的受理编号或完整私密查询链接；换设备需使用私密链接'; queryError.hidden = false; }
    return;
  }
  try {
    const order = await api(`orders/${encodeURIComponent(id)}`);
    if (version !== lookupVersion) return;
    remember(order.id);
    queryForm.reset();
    shownKey = '';
    showOrder(order, { scroll });
  } catch (error) {
    if (version === lookupVersion && !quiet) { queryError.textContent = error.message; queryError.hidden = false; }
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
const feedToggle = $('[data-feed-toggle]');
let feedData = null;
let feedPaused = false;
function renderFeed() {
  if (!feedData) return;
  const { items, now } = feedData;
  const item = (row, hidden = false) => `<li class="v-feed__item"${hidden ? ' aria-hidden="true"' : ''}><span class="v-feed__ok">${CHECK}</span><div><b>${esc(row.code)}</b><span>本站处理通过</span></div><time datetime="${new Date(row.at).toISOString()}">${esc(ago(row.at, now))}</time></li>`;
  // Measure only the original, consented records. Copies make one seamless loop,
  // never add to totals and remain hidden from assistive technology.
  feedWin.classList.remove('is-rolling');
  feedList.innerHTML = items.length ? items.map(row => item(row)).join('') : '<li class="v-feed__empty">还没有公开的通过记录。</li>';
  const height = feedList.scrollHeight;
  const rolling = items.length > 1 && height > feedWin.clientHeight;
  if (rolling) feedList.insertAdjacentHTML('beforeend', items.map(row => item(row, true)).join(''));
  feedWin.classList.toggle('is-rolling', rolling);
  feedWin.classList.toggle('is-paused', feedPaused);
  feedWin.style.setProperty('--v-roll', `${Math.max(20, height / 22)}s`);
  feedToggle.hidden = !rolling || reduceMotion.matches;
}
feedToggle.addEventListener('click', () => {
  feedPaused = !feedPaused;
  feedWin.classList.toggle('is-paused', feedPaused);
  feedToggle.setAttribute('aria-pressed', String(feedPaused));
  feedToggle.setAttribute('aria-label', feedPaused ? '继续信息流滚动' : '暂停信息流滚动');
  feedToggle.textContent = feedPaused ? '继续' : '暂停';
  feedWin.scrollTop = 0;
});
new ResizeObserver(renderFeed).observe(feedWin);
reduceMotion.addEventListener('change', renderFeed);
async function loadFeed() {
  try {
    feedData = await api('feed');
    $('[data-stat="passed"]').textContent = feedData.today.passed;
    $('[data-stat="total-passed"]').textContent = feedData.totalPassed ?? '—';
    renderFeed();
  } catch {
    $('[data-stat="passed"]').textContent = '—';
    $('[data-stat="total-passed"]').textContent = '—';
    feedData = null;
    feedWin.classList.remove('is-rolling');
    feedToggle.hidden = true;
    feedList.innerHTML = '<li class="v-feed__empty">暂时无法获取最新通过记录，请稍后重试。</li>';
  }
}

/* ---------- start ---------- */
async function start() {
  // Fragments never reach HTTP logs. Consume before any requests and remove
  // from browser history; the Session Key is never placed in the URL/storage.
  const incoming = new URL(location.href);
  const id = (incoming.searchParams.get('order') || '').toUpperCase();
  const access = new URLSearchParams(incoming.hash.slice(1)).get('access');
  if (ORDER_PATTERN.test(id) && /^[A-Za-z0-9_-]{43}$/.test(access || '')) remember(id, access);
  if (incoming.hash.startsWith('#access=')) { incoming.hash = ''; history.replaceState(null, '', incoming); }
  renderRecent();
  checkCode();
  try {
    config = await api('config');
  } catch {
    config = null;
  }
  renderIntake();
  const banner = $('[data-mode-banner]');
  if (config?.intakeMode !== 'external' && config?.mode === 'mock') {
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
        if (order.external?.source === 'session' && order.status === 'reviewing') showOrder(order);
      } catch { /* the order list still offers it */ }
    }
  }
  loadFeed();
  setInterval(loadFeed, 60000);
}
// A pasted link may change only the fragment of the current URL, which does
// not reload this ES module. Consume it with the same rules as initial load.
window.addEventListener('hashchange', () => {
  if (!location.hash.startsWith('#access=')) return;
  const incoming = new URL(location.href);
  const id = (incoming.searchParams.get('order') || '').toUpperCase();
  const access = new URLSearchParams(incoming.hash.slice(1)).get('access');
  if (ORDER_PATTERN.test(id) && /^[A-Za-z0-9_-]{43}$/.test(access || '')) remember(id, access);
  incoming.hash = '';
  history.replaceState(null, '', incoming);
  if (ORDER_PATTERN.test(id)) openOrder(id);
});
start();
