// /verify/admin/: the reviewer's page. Lists orders, shows the full code, records the result.
// The session cookie is HttpOnly and scoped to /api/verify/admin; this script never sees it.
import { VERIFY, yuan, STATUS_NAMES, REFUND_NAMES } from './verify-rules.mjs?v=key-only-20261017';

const API = new URL('../../api/verify/', import.meta.url);
const $ = (selector, root = document) => root.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const pad = n => String(n).padStart(2, '0');
const stamp = ms => {
  if (!ms) return '—';
  const d = new Date(ms);
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const left = ms => {
  const minutes = Math.round(Math.abs(ms) / 60000);
  const text = minutes < 60 ? `${minutes} 分` : `${Math.floor(minutes / 60)} 时 ${minutes % 60} 分`;
  return ms < 0 ? `超时 ${text}` : `剩 ${text}`;
};

const loginForm = $('[data-login]');
const app = $('[data-app]');
const rows = $('[data-rows]');
const detail = $('[data-detail]');
const FILTERS = [['submitted', '待核单'], ['rejected', '核单未通过'], ['reviewing', '审核中'], ['unpaid', '待付款'], ['refund', '退款'], ['passed', '已通过'], ['failed', '未通过'], ['expired', '已过期'], ['', '全部']];
const CHANNELS = { alipay: '支付宝', wechat: '微信支付', mock: '测试通道' };
const PAYMENT_STATES = { pending: '待付款', paid: '已付款', duplicate: '重复付款', closed: '已关闭' };
const TONES = { submitted: 'amber', rejected: 'rose', unpaid: 'amber', reviewing: 'violet', passed: 'green', failed: 'rose', expired: 'gray' };
const EVENTS = { session_submitted: 'Session Key 提交', external_submitted: '淘宝资料提交', external_confirmed: '人工核单通过', external_rejected: '核单未通过', external_refunded: '登记淘宝退款', external_expired: '核单超时关闭并清除凭据',
  created: '用户提交', payment_opened: '生成付款二维码', payment_error: '二维码生成失败', paid: '付款成功', duplicate_payment: '重复付款（自动全额退回）',
  payment_amount_mismatch: '付款金额不符', passed: '标记通过', failed: '标记未通过', refund_success: '退款成功', refund_processing: '退款处理中',
  refund_error: '退款失败', refund_pending: '等待退款', expired: '订单过期', code_purged: '代码已删除', mock_paid: '模拟收款',
};
let state = { status: 'submitted', q: '', page: 1, selected: null, mode: 'off' };
let detailVersion = 0, listVersion = 0, statsVersion = 0, sessionVersion = 0;
let displayedOrder = null;
const pendingOrders = new Set();

async function api(path, options = {}) {
  const response = await fetch(new URL(path, API), {
    method: options.method || 'GET',
    headers: options.method && options.method !== 'GET' ? { 'Content-Type': 'application/json', 'X-GetToken-Admin': '1' } : undefined,
    body: options.body ? JSON.stringify(options.body) : options.method && options.method !== 'GET' ? '{}' : undefined,
    cache: 'no-store',
  });
  let data = {};
  try { data = await response.json(); } catch { /* not JSON */ }
  if (response.status === 401 && !path.endsWith('login')) {
    showLogin();
    throw new Error('登录已过期，请重新登录');
  }
  if (!response.ok) throw new Error(data.error || `请求失败（${response.status}）`);
  return data;
}

const toast = $('[data-toast]');
let toastTimer = 0;
function showToast(message) {
  toast.textContent = message;
  toast.classList.add('is-shown');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('is-shown'), 2600);
}

function showLogin(hint) {
  sessionVersion++;
  detailVersion++; listVersion++; statsVersion++;
  displayedOrder = null;
  state.selected = null;
  detail.innerHTML = '';
  app.hidden = true;
  $('[data-logout]').hidden = true;
  $('[data-mode-banner]').hidden = true;
  loginForm.hidden = false;
  if (hint) $('[data-login-hint]').textContent = hint;
  $('#a-password').focus();
}

loginForm.addEventListener('submit', async event => {
  event.preventDefault();
  const error = $('[data-login-error]');
  error.hidden = true;
  try {
    await api('admin/login', { method: 'POST', body: { password: new FormData(loginForm).get('password') } });
    loginForm.reset();
    await start();
  } catch (err) {
    error.textContent = err.message;
    error.hidden = false;
  }
});
$('[data-logout]').addEventListener('click', async () => {
  showLogin('正在退出登录…');
  await api('admin/logout', { method: 'POST' }).catch(() => {});
  showLogin('已退出登录。');
});

/* ---------- list ---------- */
const filterBox = $('[data-filters]');
filterBox.innerHTML = FILTERS.map(([key, label]) => `<button type="button" role="tab" data-filter="${key}">${label}</button>`).join('');
filterBox.addEventListener('click', event => {
  const button = event.target.closest('[data-filter]');
  if (!button) return;
  state = { ...state, status: button.dataset.filter, page: 1 };
  loadList();
});
$('[data-search]').addEventListener('submit', event => {
  event.preventDefault();
  state = { ...state, q: new FormData(event.target).get('q').trim(), page: 1 };
  loadList();
});
$('[data-pager]').addEventListener('click', event => {
  const button = event.target.closest('[data-page]');
  if (!button) return;
  state.page = Number(button.dataset.page);
  loadList();
});

async function loadStats() {
  const version = ++statsVersion;
  const s = await api('admin/stats');
  if (version !== statsVersion || app.hidden) return;
  $('[data-stats]').innerHTML = [
    ['is-blue', s.reviewing, '审核中'], ['is-rose', s.overdue, '已超过 24 小时'], ['is-amber', s.submitted, '待核单'],
    ['is-green', s.passedToday, '今日通过'], ['', s.failedToday, '今日未通过'], [s.refundOverdue ? 'is-rose' : 'is-amber', s.refunding, s.refundOverdue ? `退款未完成 · ${s.refundOverdue} 单超过 24 小时` : '退款未完成'],
  ].map(([tone, n, label]) => `<div class="${tone}"><b>${n}</b><span>${label}</span></div>`).join('');
}

function tag(o) {
  const refund = o.refundStatus && o.refundStatus !== 'success' ? ` · ${REFUND_NAMES[o.refundStatus]}` : o.refundStatus === 'success' ? ' · 已退款' : '';
  return `<span class="v-tag v-tag--${TONES[o.status]}">${esc(STATUS_NAMES[o.status])}${esc(refund)}</span>`;
}

async function loadList() {
  const version = ++listVersion;
  for (const button of filterBox.querySelectorAll('button')) button.setAttribute('aria-selected', String(button.dataset.filter === state.status));
  const params = new URLSearchParams({ status: state.status, q: state.q, page: String(state.page) });
  const data = await api(`admin/orders?${params}`);
  if (version !== listVersion || app.hidden) return;
  const now = Date.now();
  rows.innerHTML = data.items.length ? data.items.map(o => {
    const remaining = o.status === 'reviewing' ? `<span class="${o.dueAt < now ? 'is-late' : ''}">${left(o.dueAt - now)}</span>` : '—';
    return `<tr${o.id === state.selected ? ' class="is-selected"' : ''}><td><button type="button" data-open="${esc(o.id)}" class="v-mono">${esc(o.id)}</button></td><td><button type="button" data-open="${esc(o.id)}" class="v-mono">${esc(o.code)}</button></td><td><button type="button" data-open="${esc(o.id)}">${tag(o)}</button></td><td><button type="button" data-open="${esc(o.id)}">${esc(stamp(o.paidAt))}</button></td><td><button type="button" data-open="${esc(o.id)}">${remaining}</button></td></tr>`;
  }).join('') : '<tr><td colspan="5" class="a-empty">没有符合条件的订单</td></tr>';
  const pages = Math.max(1, Math.ceil(data.total / data.size));
  $('[data-pager]').innerHTML = pages > 1
    ? `${state.page > 1 ? `<button class="v-btn v-btn--ghost v-btn--sm" type="button" data-page="${state.page - 1}">上一页</button>` : ''}<span class="v-hint">第 ${state.page} / ${pages} 页 · 共 ${data.total} 单</span>${state.page < pages ? `<button class="v-btn v-btn--ghost v-btn--sm" type="button" data-page="${state.page + 1}">下一页</button>` : ''}`
    : `<span class="v-hint">共 ${data.total} 单</span>`;
}
rows.addEventListener('click', event => {
  const button = event.target.closest('[data-open]');
  if (button) openDetail(button.dataset.open);
});

/* ---------- detail ---------- */
async function openDetail(id) {
  const version = ++detailVersion;
  state.selected = id;
  displayedOrder = null;
  detail.innerHTML = '<p class="v-hint">正在加载订单…</p>';
  for (const tr of rows.querySelectorAll('tr')) tr.classList.toggle('is-selected', !!tr.querySelector(`[data-open="${CSS.escape(id)}"]`));
  try {
    const order = await api(`admin/orders/${encodeURIComponent(id)}`);
    if (version === detailVersion && state.selected === id && !app.hidden) renderDetail(order);
  } catch (error) {
    if (version === detailVersion && !app.hidden) detail.innerHTML = `<p class="v-error">${esc(error.message)}</p>`;
  }
}

function renderDetail(o) {
  if (o.id !== state.selected || app.hidden) return;
  displayedOrder = o;
  const now = Date.now();
  const code = o.code
    ? `<div class="a-code" data-code-text>${esc(o.code)}</div><button class="v-btn v-btn--ghost v-btn--sm" type="button" data-copy-code>复制 Session Key</button>`
    : `<p class="a-code">${o.codePurged ? '代码已按规则删除，只保留末 4 位。' : '代码无法解密，请检查服务器的 VERIFY_SECRET 是否被更换。'}</p>`;
  const actions = [];
  if (o.status === 'submitted' && o.external) {
    actions.push(`<h2>人工核对淘宝订单</h2><p class="v-hint">请在淘宝商家后台核对订单归属、购买内容、实付金额及售后约定；本站未接入淘宝付款验证。</p><textarea class="a-reason" data-reason maxlength="300" placeholder="核单记录或驳回原因（必填；驳回原因用户可见，勿填凭据）"></textarea><div class="a-decide"><button class="v-btn v-btn--ok" type="button" data-check-external="accept">核单通过，开始处理</button><button class="v-btn v-btn--no" type="button" data-check-external="reject">核单未通过</button></div>`);
  }
  if (o.status === 'failed' && o.external && o.refundStatus === 'pending') {
    actions.push(`<h2>登记淘宝售后</h2><p class="v-hint">请先在淘宝完成退款核对，再登记凭证摘要。此操作只更新本站状态，不会发起退款。</p><textarea class="a-reason" data-reason maxlength="300" placeholder="淘宝退款凭证或核对记录摘要（必填；勿填凭据）"></textarea><button class="v-btn v-btn--light v-btn--block" type="button" data-external-refund>登记已处理淘宝退款</button>`);
  }
  if (o.status === 'reviewing') {
    actions.push(`<h2>录入结果</h2><textarea class="a-reason" data-reason maxlength="300" placeholder="交付证据摘要或未通过原因（正式服务必填，用户可见；勿填凭据）"></textarea>
<div class="a-decide"><button class="v-btn v-btn--ok" type="button" data-decide="passed">通过</button><button class="v-btn v-btn--no" type="button" data-decide="failed">${o.external?.source === 'session' ? '未通过' : o.external ? '未通过，转淘宝售后' : '未通过并退审核费'}</button></div>`);
  }
  if (o.refunds.some(r => r.status !== 'success')) actions.push('<button class="v-btn v-btn--light v-btn--block" type="button" data-refund>重试 / 刷新退款状态</button>');
  if (o.status === 'unpaid' && state.mode === 'mock') actions.push('<button class="v-btn v-btn--light v-btn--block" type="button" data-mock-pay>模拟收款（测试模式）</button>');
  const due = o.status === 'reviewing' ? `${stamp(o.dueAt)}（${left(o.dueAt - now)}）` : stamp(o.dueAt);
  detail.innerHTML = `<div class="v-order__top"><span class="v-mono">${esc(o.id)}</span>${tag(o)}</div>
${o.external?.source === 'taobao' ? `<h2>淘宝订单号</h2><div class="a-code">${esc(o.external.reference)}</div>${o.external.checkNote ? `<p class="v-hint">核单记录：${esc(o.external.checkNote)}</p>` : ''}${o.external.refundNote ? `<p class="v-hint">售后记录：${esc(o.external.refundNote)}</p>` : ''}` : ''}
<h2>Session Key</h2>${code}
${o.repeats ? `<p class="a-warn">同一个代码之前还提交过 ${o.repeats} 次。</p>` : ''}
<dl class="v-kv">
<div><dt>提交</dt><dd>${esc(stamp(o.createdAt))}</dd></div>
<div><dt>${o.external?.source === 'session' ? '提交' : o.external ? '核单' : '付款'}</dt><dd>${esc(stamp(o.paidAt))}</dd></div>
<div><dt>预计出结果</dt><dd>${esc(due)}</dd></div>
${o.decidedAt ? `<div><dt>出结果</dt><dd>${esc(stamp(o.decidedAt))}</dd></div>` : ''}
${o.reason ? `<div><dt>原因</dt><dd>${esc(o.reason)}</dd></div>` : ''}
${o.refundDueAt ? `<div><dt>退款截止</dt><dd>${esc(stamp(o.refundDueAt))}</dd></div>` : ''}
<div><dt>同意展示</dt><dd>${o.showPublic ? '是' : '否'}</dd></div>
</dl>
${actions.join('\n')}
${o.payments.length ? `<h2>付款</h2><dl class="v-kv">${o.payments.map(p => `<div><dt>${esc(CHANNELS[p.channel] || p.channel)} · ${esc(PAYMENT_STATES[p.status] || p.status)}</dt><dd>${yuan(p.amount)}${p.tradeNo ? `<br><span class="v-mono">${esc(p.tradeNo)}</span>` : ''}</dd></div>`).join('')}</dl>` : ''}
${o.refunds.length ? `<h2>退款</h2><dl class="v-kv">${o.refunds.map(r => `<div><dt>${r.kind === 'audit' ? '审核费' : '重复付款'} · ${esc(REFUND_NAMES[r.status] || r.status)}</dt><dd>${yuan(r.amount)}${r.error ? `<br><span class="v-error">${esc(r.error)}</span>` : ''}</dd></div>`).join('')}</dl>` : ''}
<ol class="a-log">${o.events.map(e => `<li><span>${esc(EVENTS[e.kind] || e.kind)}${e.detail && !['payment_opened', 'paid', 'created'].includes(e.kind) ? ` · ${esc(e.detail)}` : ''}</span><time>${esc(stamp(e.at))}</time></li>`).join('')}</ol>`;
  for (const action of detail.querySelectorAll('button')) action.disabled = pendingOrders.has(o.id);
}

detail.addEventListener('click', async event => {
  const button = event.target.closest('button');
  if (!button || button.disabled || !displayedOrder || displayedOrder.id !== state.selected || app.hidden) return;
  const id = displayedOrder.id;
  const version = detailVersion;
  const session = sessionVersion;
  if (pendingOrders.has(id)) return;
  if (button.hasAttribute('data-copy-code')) {
    try {
      await navigator.clipboard.writeText($('[data-code-text]', detail).textContent);
      showToast('已复制 Session Key');
    } catch {
      showToast('复制失败，请手动选择');
    }
    return;
  }
  let request = null;
  if (button.dataset.checkExternal || button.hasAttribute('data-external-refund')) {
    const reason = $('[data-reason]', detail)?.value.trim() || '';
    if (!reason) { showToast('请先填写核对记录或原因'); $('[data-reason]', detail)?.focus(); return; }
    const accepted = button.dataset.checkExternal === 'accept';
    const refund = button.hasAttribute('data-external-refund');
    const question = refund ? `确认 ${id} 已在淘宝处理退款并核对凭证？此操作只登记状态。` : accepted ? `确认 ${id} 的淘宝订单归属、购买内容及实付金额已核对，开始处理？` : `确认 ${id} 核单未通过？原因将向用户展示。`;
    if (!window.confirm(question)) return;
    request = [`admin/orders/${encodeURIComponent(id)}/${refund ? 'external-refund' : 'check-external'}`, refund ? { reason } : { accepted, reason }];
  } else if (button.dataset.decide) {
    const passed = button.dataset.decide === 'passed';
    const reason = $('[data-reason]', detail)?.value.trim() || '';
    const identity = `${id}（Session Key 末 4 位：${String(displayedOrder.code || displayedOrder.codeTail || '').slice(-4) || '不可用'}）`;
    const question = displayedOrder.external?.source === 'session' && !passed ? `确认 ${identity} 处理未通过？原因将展示给用户。` : displayedOrder.external && !passed ? `确认 ${identity} 未通过？需通过淘宝原订单处理售后，本站不会发起退款。` : passed ? `确认 ${identity} 审核通过？\n用户页面会显示本站处理结果，不代表官方认证通过。` : `确认 ${identity} 未通过？\n会立即原路退回审核费 ${yuan(VERIFY.auditFeeMinor)}，技术费不退。${reason ? `\n原因：${reason}` : ''}`;
    if (!window.confirm(question)) return;
    request = [`admin/orders/${encodeURIComponent(id)}/decision`, { result: button.dataset.decide, reason }];
  } else if (button.hasAttribute('data-refund')) {
    request = [`admin/orders/${encodeURIComponent(id)}/refund`];
  } else if (button.hasAttribute('data-mock-pay')) {
    request = [`admin/orders/${encodeURIComponent(id)}/mock-pay`];
  }
  if (!request) return;
  if (version !== detailVersion || displayedOrder?.id !== id || app.hidden) return;
  pendingOrders.add(id);
  for (const action of detail.querySelectorAll('button')) action.disabled = true;
  try {
    const order = await api(request[0], { method: 'POST', body: request[1] });
    pendingOrders.delete(id);
    if (session !== sessionVersion) return;
    // Also invalidate a GET started while this mutation was still pending.
    if (state.selected === id && !app.hidden) { detailVersion++; renderDetail(order); }
    if (app.hidden) return;
    showToast(`${id} 已保存`);
    await Promise.all([loadStats(), loadList()]);
  } catch (error) {
    if (session === sessionVersion && !app.hidden) showToast(error.message);
  } finally {
    pendingOrders.delete(id);
    if (displayedOrder?.id === id && !app.hidden) {
      for (const action of detail.querySelectorAll('button')) action.disabled = false;
    }
  }
});

/* ---------- start ---------- */
let refreshTimer = 0;
async function start() {
  const session = sessionVersion;
  const me = await api('admin/me');
  if (session !== sessionVersion) return;
  state.mode = me.mode;
  if (me.keyOnlyIntake || !me.intakeMode || me.intakeMode === 'online') state.status = 'reviewing';
  if (!me.loggedIn) {
    showLogin(me.passwordSet ? '输入在服务器上设置的后台密码。' : '后台密码还没有设置：在服务器上运行 gettoken-verify passwd 设置后再登录。');
    return;
  }
  loginForm.hidden = true;
  app.hidden = false;
  $('[data-logout]').hidden = false;
  const banner = $('[data-mode-banner]');
  banner.hidden = me.intakeMode !== 'external' && me.mode === 'live';
  banner.textContent = me.keyOnlyIntake ? '仅提交 Session Key，受理后人工处理；本站不提供支付。' : me.intakeMode === 'external' ? '淘宝订单由人工核验，本站不收款；售后在淘宝原订单处理。' : me.mode === 'mock' ? '测试模式：不会真实收款或退款。' : '在线支付未开通：在服务器的 /etc/gettoken/verify.env 中配置支付宝或微信支付。';
  await Promise.all([loadStats(), loadList()]);
  clearInterval(refreshTimer);
  refreshTimer = setInterval(() => { if (!app.hidden && document.visibilityState === 'visible') Promise.all([loadStats(), loadList()]).catch(() => {}); }, 30000);
}
start().catch(error => {
  app.hidden = true;
  loginForm.hidden = false;
  $('[data-login-hint]').textContent = /fetch|network/i.test(error.message) ? '无法连接审核服务，请确认服务器上的 gettoken-verify 服务正在运行。' : error.message;
});
