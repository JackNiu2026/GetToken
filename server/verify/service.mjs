// Order lifecycle. Results come only from decide(), which only the admin API calls:
// processing countdowns never decide a result; unchecked intake can expire for privacy.
import { VERIFY, codeProblem, normalizeCode, maskTail, SERVICE_CONTRACT, serviceContractReady } from '../../assets/gettoken/verify-rules.mjs';
import { orderId, compactId, sealCode, openCode, fingerprint, sha256, beijingDayStart, token } from './secure.mjs';
import { accessDigest } from './access.mjs';

const HOUR = 3600_000;
const MINUTE = 60_000;

export class UserError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export function createService({ store, config, providers, now = () => Date.now(), log = () => {} }) {
  const event = (orderIdValue, actor, kind, detail = null) =>
    store.run('insert into events(order_id, at, actor, kind, detail) values(?, ?, ?, ?, ?)', orderIdValue, now(), actor, kind, detail);
  const getOrder = id => store.get('select * from orders where id = ?', id);
  const channels = () => Object.keys(providers);
  const acceptingNewOrders = () => !config.externalIntake && channels().length > 0 && config.acceptNewOrders !== false
    && (config.mode === 'mock' || (config.mode === 'live' && (config.acceptNewOrders ?? VERIFY.open)
      && serviceContractReady(config.serviceContract || SERVICE_CONTRACT) && !!store.setting('admin_password')));
  const providerFor = channel => {
    if (!Object.hasOwn(providers, channel)) throw new UserError('不支持的付款方式');
    return providers[channel];
  };

  /* ---------- payments ---------- */
  const opening = new Map();
  const syncing = new Map();
  const unsettled = payment => payment.status === 'pending' || (payment.status === 'closed' && payment.reconciled_at === null);

  async function createPayment(order, channel) {
    const provider = providerFor(channel);
    const t = now();
    const payment = store.transaction(() => {
      const existing = store.get("select * from payments where order_id = ? and channel = ? and status = 'pending' and expires_at > ? order by created_at desc limit 1", order.id, channel, t + MINUTE);
      if (existing) return existing;
      const attempt = store.get('select count(*) as n from payments where order_id = ?', order.id).n + 1;
      if (attempt > 12) throw new UserError('付款二维码获取次数过多，请重新提交订单', 429);
      const id = `${compactId(order.id)}P${attempt}`;
      store.run("insert into payments(id, order_id, channel, status, amount, created_at, expires_at) values(?, ?, ?, 'pending', ?, ?, ?)",
        id, order.id, channel, order.tech_fee + order.audit_fee, t, t + VERIFY.paymentMinutes * MINUTE);
      return store.get('select * from payments where id = ?', id);
    });
    if (payment.qr) return payment;
    // Reserve before the network request: retries reuse the same platform id, and
    // even a notification arriving before precreate returns can find its payment.
    const { qr } = await provider.precreate({ outTradeNo: payment.id, amountMinor: payment.amount, subject: `GetToken 审核验证 ${order.id}`, expiresAt: payment.expires_at });
    if (typeof qr !== 'string' || !qr) throw new Error('Payment platform returned no QR code');
    store.run('update payments set qr = ? where id = ?', qr, payment.id);
    event(order.id, 'system', 'payment_opened', `${channel} ${payment.id}`);
    return store.get('select * from payments where id = ?', payment.id);
  }

  async function openPayment(order, channel) {
    providerFor(channel);
    const key = `${order.id}:${channel}`;
    if (opening.has(key)) return opening.get(key);
    const task = createPayment(order, channel);
    opening.set(key, task);
    try { return await task; } finally { opening.delete(key); }
  }

  // Called from a verified payment notification or a verified query result.
  function markPaid(paymentId, { tradeNo, amountMinor }) {
    const known = store.get('select * from payments where id = ?', paymentId);
    if (!known) throw new Error(`Unknown payment ${paymentId}`);
    if (amountMinor !== known.amount) {
      event(known.order_id, 'system', 'payment_amount_mismatch', `${paymentId} ${amountMinor} != ${known.amount}`);
      throw new Error(`Amount mismatch for ${paymentId}`);
    }
    if (typeof tradeNo !== 'string' || !tradeNo.trim()) throw new Error(`Missing trade number for ${paymentId}`);
    return store.transaction(() => {
      const payment = store.get('select * from payments where id = ?', paymentId);
      if (payment.trade_no && payment.trade_no !== tradeNo) throw new Error(`Trade number mismatch for ${paymentId}`);
      if (store.get('select id from payments where channel = ? and trade_no = ? and id != ?', payment.channel, tradeNo, paymentId)) throw new Error(`Trade number already used for ${paymentId}`);
      if (payment.status === 'paid' || payment.status === 'duplicate') return payment;
      const t = now();
      const order = getOrder(payment.order_id);
      // A very late payment for a code already purged cannot be reviewed. Return
      // it in full through the same idempotent compensation path as an overpayment.
      const first = (order.status === 'unpaid' || order.status === 'expired') && !!order.code_sealed;
      store.run('update payments set status = ?, trade_no = ?, paid_at = ? where id = ?', first ? 'paid' : 'duplicate', tradeNo || null, t, paymentId);
      if (first) {
        store.run("update orders set status = 'reviewing', paid_at = ?, due_at = ?, paid_payment = ? where id = ?", t, t + VERIFY.reviewHours * HOUR, paymentId, order.id);
        event(order.id, 'system', 'paid', `${payment.channel} ${paymentId}`);
      } else {
        // Paid twice (two QR codes): the second payment goes straight back in full.
        store.run("insert into refunds(id, order_id, payment_id, channel, kind, amount, status, created_at, updated_at) values(?, ?, ?, ?, 'duplicate', ?, 'pending', ?, ?)",
          `${paymentId}R`, order.id, paymentId, payment.channel, payment.amount, t, t);
        event(order.id, 'system', 'duplicate_payment', `${payment.channel} ${paymentId}`);
      }
      return store.get('select * from payments where id = ?', paymentId);
    });
  }

  async function reconcilePayment(id, { force = false } = {}) {
    const payment = store.get('select * from payments where id = ?', id);
    if (!payment || !unsettled(payment) || !Object.hasOwn(providers, payment.channel)) return payment;
    const t = now();
    if (!force && payment.checked_at !== null && t - payment.checked_at < 5000) return payment;
    store.run('update payments set checked_at = ? where id = ?', t, payment.id);
    try {
      const provider = providers[payment.channel];
      const result = await provider.query(payment.id);
      if (result.paid) return markPaid(payment.id, result);
      const order = getOrder(payment.order_id);
      const shouldClose = payment.expires_at <= now() || !['unpaid', 'expired'].includes(order.status);
      const closed = result.closed || (shouldClose && provider.close && (await provider.close(payment.id)).closed);
      if (closed) {
        // The callback may have marked this row paid while we awaited close().
        store.run("update payments set status = 'closed', reconciled_at = ? where id = ? and status in ('pending', 'closed')", now(), payment.id);
      }
    } catch (error) {
      log(`payment query ${payment.id}: ${error.message}`);
    }
    return store.get('select * from payments where id = ?', id);
  }

  async function syncPayment(payment, options = {}) {
    if (syncing.has(payment.id)) return syncing.get(payment.id);
    const task = reconcilePayment(payment.id, options);
    syncing.set(payment.id, task);
    try { return await task; } finally { syncing.delete(payment.id); }
  }

  /* ---------- public API ---------- */
  const acceptingExternalOrders = () => config.externalIntake === true && config.acceptExternalOrders !== false
    && !!store.setting('admin_password');
  const external = id => store.get('select * from external_orders where order_id = ?', id);
  const externalView = o => {
    const e = external(o.id);
    return e ? { source: e.source, ...(e.source === 'taobao' ? { reference: `尾号 ${e.reference_tail}` } : {}), checkedAt: e.checked_at } : null;
  };
  function createSessionOrder({ code: raw, agree, showPublic, ip }) {
    if (!acceptingExternalOrders()) throw new UserError('资料提交暂不可用，请稍后重试', 503);
    const code = normalizeCode(raw), problem = codeProblem(code);
    if (problem) throw new UserError(problem);
    if (agree !== true) throw new UserError('请确认账户归属与资料提交授权');
    return store.transaction(() => {
      const fp = fingerprint(config.secret, code);
      if (store.get("select id from orders where code_fp = ? and status in ('submitted', 'reviewing')", fp)) {
        throw new UserError('此 Session Key 已在处理中，请使用原浏览器或私密链接查询', 409);
      }
      const t = now(), accessToken = token();
      let id; do id = orderId(t); while (getOrder(id));
      store.run("insert into orders(id, code_sealed, code_tail, code_fp, show_public, status, tech_fee, audit_fee, created_at, paid_at, due_at, ip_hash, access_hash) values(?, ?, ?, ?, ?, 'reviewing', 0, 0, ?, ?, ?, ?, ?)",
        id, sealCode(config.secret, code), code.slice(-4), fp, showPublic === true ? 1 : 0, t, t, t + VERIFY.reviewHours * HOUR,
        ip ? fingerprint(config.secret, `ip:${ip}`) : null, accessDigest(id, accessToken));
      // Reuse the additive intake metadata table without storing a purchase reference.
      store.run('insert into external_orders(order_id, source, reference_sealed, reference_hash, reference_tail) values(?, ?, ?, ?, ?)',
        id, 'session', sealCode(config.secret, ''), fingerprint(config.secret, `session:${id}`), '');
      event(id, 'user', 'session_submitted');
      return { ...view(getOrder(id)), accessToken };
    });
  }
  function createExternalOrder({ code: raw, reference: rawReference, source = 'taobao', agree, showPublic, ip }) {
    if (!acceptingExternalOrders()) throw new UserError('资料提交暂不可用，请稍后重试', 503);
    const code = normalizeCode(raw), problem = codeProblem(code);
    if (problem) throw new UserError(problem);
    if (agree !== true) throw new UserError('请确认账户归属与资料提交授权');
    if (source !== 'taobao') throw new UserError('本轮仅支持淘宝订单');
    const reference = String(rawReference || '').trim();
    if (!/^\d{10,32}$/.test(reference)) throw new UserError('请填写完整淘宝订单号（10–32 位数字）');
    const referenceHash = fingerprint(config.secret, `${source}:${reference}`);
    const accessToken = token(), t = now();
    return store.transaction(() => {
      if (store.get('select order_id from external_orders where reference_hash = ?', referenceHash)) {
        throw new UserError('此订单已提交，请使用原浏览器或私密链接查询；无法找回时联系支持方核实', 409);
      }
      let id; do id = orderId(t); while (getOrder(id));
      store.run("insert into orders(id, code_sealed, code_tail, code_fp, show_public, status, tech_fee, audit_fee, created_at, ip_hash, access_hash) values(?, ?, ?, ?, ?, 'submitted', ?, ?, ?, ?, ?)",
        id, sealCode(config.secret, code), code.slice(-4), fingerprint(config.secret, code), showPublic === true ? 1 : 0,
        0, 0, t, ip ? fingerprint(config.secret, `ip:${ip}`) : null, accessDigest(id, accessToken));
      store.run('insert into external_orders(order_id, source, reference_sealed, reference_hash, reference_tail) values(?, ?, ?, ?, ?)',
        id, source, sealCode(config.secret, reference), referenceHash, reference.slice(-4));
      event(id, 'user', 'external_submitted');
      return { ...view(getOrder(id)), accessToken };
    });
  }
  function checkExternalOrder(id, accepted, reason) {
    const note = String(reason || '').trim();
    if (!note || note.length > 300) throw new UserError('请填写核单记录或驳回原因（最多 300 字，不得包含凭据）');
    if (typeof accepted !== 'boolean') throw new UserError('核单结果不正确');
    return store.transaction(() => {
      const o = getOrder(id);
      if (!o || !external(id)) throw new UserError('找不到外部订单', 404);
      if (o.status !== 'submitted') throw new UserError('订单已核对，请勿重复操作', 409);
      if (accepted && !o.code_sealed) throw new UserError('会话资料已清除，请先联系用户核实', 409);
      const t = now();
      store.run('update external_orders set checked_at = ?, check_note = ? where order_id = ?', t, note, id);
      store.run('update orders set status = ?, paid_at = ?, due_at = ?, decided_at = ?, reason = ? where id = ?',
        accepted ? 'reviewing' : 'rejected', accepted ? t : null, accepted ? t + VERIFY.reviewHours * HOUR : null,
        accepted ? null : t, accepted ? null : note, id);
      event(id, 'admin', accepted ? 'external_confirmed' : 'external_rejected', note);
      return adminDetail(id);
    });
  }
  function recordExternalRefund(id, reason) {
    const note = String(reason || '').trim();
    if (!note || note.length > 300) throw new UserError('请填写退款凭证或记录摘要（最多 300 字）');
    return store.transaction(() => {
      const o = getOrder(id);
      if (!o || !external(id)) throw new UserError('找不到外部订单', 404);
      if (o.status !== 'failed' || o.refund_status !== 'pending') throw new UserError('此订单没有待登记的线下退款', 409);
      store.run('update external_orders set refund_note = ? where order_id = ?', note, id);
      store.run("update orders set refund_status = 'success', refunded_at = ? where id = ?", now(), id);
      event(id, 'admin', 'external_refunded', note);
      return adminDetail(id);
    });
  }
  async function createOrder({ code: raw, showPublic, agree, channel, ip }) {
    if (!acceptingNewOrders()) throw new UserError('在线支付暂未开通，请稍后再来', 503);
    const code = normalizeCode(raw);
    const problem = codeProblem(code);
    if (problem) throw new UserError(problem);
    if (agree !== true) throw new UserError('请先确认费用与退款规则');
    providerFor(channel);
    const t = now();
    let id;
    do id = orderId(t); while (getOrder(id));
    const accessToken = token();
    store.run("insert into orders(id, code_sealed, code_tail, code_fp, show_public, status, tech_fee, audit_fee, created_at, ip_hash, access_hash) values(?, ?, ?, ?, ?, 'unpaid', ?, ?, ?, ?, ?)",
      id, sealCode(config.secret, code), code.slice(-4), fingerprint(config.secret, code), showPublic === true ? 1 : 0, VERIFY.techFeeMinor, VERIFY.auditFeeMinor, t, ip ? fingerprint(config.secret, `ip:${ip}`) : null, accessDigest(id, accessToken));
    event(id, 'user', 'created', showPublic === true ? '同意匿名展示' : null);
    try {
      await openPayment(getOrder(id), channel);
    } catch (error) {
      log(`precreate ${id}: ${error.message}`);
      event(id, 'system', 'payment_error', error.message.slice(0, 300));
      if (error instanceof UserError) throw error;
      throw new UserError('付款二维码获取失败，请稍后重试或换一种付款方式', 502);
    }
    return { ...view(getOrder(id)), accessToken };
  }

  async function requestPayment(id, channel) {
    if (config.externalIntake) throw new UserError('站内支付已关闭，请通过原交易渠道处理', 503);
    const order = getOrder(id);
    if (!order) throw new UserError('找不到这个订单', 404);
    if (order.status !== 'unpaid' && order.status !== 'expired') throw new UserError('这个订单已经付款');
    if (now() - order.created_at > 24 * HOUR) throw new UserError('订单已过期，请重新提交', 410);
    try {
      await openPayment(order, channel);
    } catch (error) {
      if (error instanceof UserError) throw error;
      log(`precreate ${id}: ${error.message}`);
      throw new UserError('付款二维码获取失败，请稍后重试或换一种付款方式', 502);
    }
    return view(getOrder(id), channel);
  }

  async function lookup(id, channel) {
    let order = getOrder(id);
    if (!order) throw new UserError('找不到这个订单，请核对订单号', 404);
    // Paid orders can still have other paid QR codes whose notifications were lost.
    for (const payment of store.all("select * from payments where order_id = ? and (status = 'pending' or (status = 'closed' and reconciled_at is null))", id)) await syncPayment(payment);
    order = getOrder(id);
    return view(order, channel);
  }

  function view(order, channel = null) {
    const t = now();
    const out = {
      id: order.id,
      status: order.status,
      code: maskTail(order.code_tail),
      fees: { tech: order.tech_fee, audit: order.audit_fee, total: order.tech_fee + order.audit_fee },
      createdAt: order.created_at,
      paidAt: order.paid_at,
      dueAt: order.due_at,
      decidedAt: order.decided_at,
      now: t,
      external: externalView(order),
    };
    if (out.external) out.fees = null; // Taobao amounts are not verified by this API.
    if (['passed', 'rejected'].includes(order.status)) out.reason = order.reason || null;
    if (order.status === 'failed') {
      out.reason = order.reason || null;
      out.refund = out.external?.source === 'session' ? null : out.external
        ? { status: order.refund_status, refundedAt: order.refunded_at }
        : { status: order.refund_status, amount: order.audit_fee, dueAt: order.refund_due_at, refundedAt: order.refunded_at };
    }
    if (order.status === 'unpaid' && !config.externalIntake) {
      const pending = store.all("select * from payments where order_id = ? and status = 'pending' and qr is not null and expires_at > ? order by created_at desc", order.id, t);
      const payment = pending.find(p => p.channel === channel) || pending[0];
      out.payment = payment ? { id: payment.id, channel: payment.channel, qr: payment.qr, amount: payment.amount, expiresAt: payment.expires_at } : null;
    }
    return out;
  }

  function feed() {
    const t = now();
    const day = beijingDayStart(t);
    const counts = store.get("select count(*) as processed, coalesce(sum(status = 'passed'), 0) as passed from orders where decided_at >= ? and status in ('passed', 'failed')", day);
    const items = store.all("select code_tail, decided_at from orders where status = 'passed' and show_public = 1 order by decided_at desc limit 20")
      .map(row => ({ code: maskTail(row.code_tail), at: row.decided_at }));
    return { now: t, today: { processed: counts.processed, passed: counts.passed }, totalPassed: store.get("select count(*) as n from orders where status = 'passed'").n, items };
  }

  /* ---------- admin ---------- */
  const REFUND_DUE = VERIFY.refundHours * HOUR;

  function decide(id, result, reason, actor = 'admin') {
    if (!['passed', 'failed'].includes(result)) throw new UserError('结果只能是通过或未通过');
    const note = String(reason || '').trim().slice(0, 300) || null;
    store.transaction(() => {
      const order = getOrder(id);
      if (!order) throw new UserError('找不到这个订单', 404);
      if (order.status !== 'reviewing') throw new UserError(order.status === 'unpaid' ? '订单还没有付款，不能录入结果' : '这个订单已经有结果了', 409);
      if ((config.mode === 'live' || external(id)) && !note) throw new UserError('请填写交付证据摘要或未通过原因；不得包含会话凭据');
      const t = now();
      if (result === 'passed') {
        store.run("update orders set status = 'passed', decided_at = ?, reason = ? where id = ?", t, note, id);
      } else {
        if (external(id)?.source === 'session') {
          store.run("update orders set status = 'failed', decided_at = ?, reason = ? where id = ?", t, note, id);
          event(id, actor, result, note);
          return;
        }
        if (external(id)) {
          store.run("update orders set status = 'failed', decided_at = ?, reason = ?, refund_status = 'pending', refund_due_at = null where id = ?", t, note, id);
          event(id, actor, result, note);
          return;
        }
        const payment = store.get('select * from payments where id = ?', order.paid_payment);
        store.run("update orders set status = 'failed', decided_at = ?, reason = ?, refund_status = 'pending', refund_due_at = ? where id = ?", t, note, t + REFUND_DUE, id);
        store.run("insert into refunds(id, order_id, payment_id, channel, kind, amount, status, created_at, updated_at) values(?, ?, ?, ?, 'audit', ?, 'pending', ?, ?)",
          `${compactId(id)}R1`, id, payment.id, payment.channel, order.audit_fee, t, t);
      }
      event(id, actor, result, note);
    });
    return getOrder(id);
  }

  // Success is monotonic: a delayed response, callback replay or failed query
  // cannot roll a completed refund back to processing.
  function markRefund(id, result, actor = 'system', failedAttempt = 0) {
    if (!['pending', 'processing', 'success', 'error'].includes(result.status)) throw new Error('Invalid refund status');
    return store.transaction(() => {
      const refund = store.get('select * from refunds where id = ?', id);
      if (!refund) throw new Error(`Unknown refund ${id}`);
      const payment = store.get('select * from payments where id = ?', refund.payment_id);
      if ((result.channel && result.channel !== refund.channel) || (result.outTradeNo && result.outTradeNo !== payment.id) ||
          (result.tradeNo && result.tradeNo !== payment.trade_no) ||
          (result.amountMinor !== undefined && result.amountMinor !== refund.amount) ||
          (result.totalMinor !== undefined && result.totalMinor !== payment.amount)) throw new Error(`Refund mismatch for ${id}`);
      if (refund.status === 'success') return refund;
      const t = now();
      const error = result.error ? String(result.error).slice(0, 300) : null;
      store.run('update refunds set status = ?, error = ?, attempts = attempts + ?, updated_at = ? where id = ?', result.status, error, failedAttempt, t, id);
      if (refund.kind === 'audit') store.run('update orders set refund_status = ?, refunded_at = ? where id = ?', result.status, result.status === 'success' ? t : null, refund.order_id);
      if (result.status !== refund.status || error) event(refund.order_id, actor, `refund_${result.status}`, `${refund.kind} ${id}${error ? ` · ${error}` : ''}`);
      return store.get('select * from refunds where id = ?', id);
    });
  }

  const refunding = new Map();
  async function settleRefund(id, actor) {
    const refund = store.get('select * from refunds where id = ?', id);
    if (!refund || refund.status === 'success') return refund;
    const provider = providers[refund.channel];
    if (!provider) return refund;
    const payment = store.get('select * from payments where id = ?', refund.payment_id);
    const querying = refund.status === 'processing';
    const params = { outTradeNo: payment.id, refundId: refund.id, amountMinor: refund.amount, totalMinor: payment.amount,
      reason: refund.kind === 'audit' ? '审核未通过，退回审核费' : '重复付款退回' };
    // Persist uncertainty before calling the platform. After a process crash we
    // query this exact refund id rather than issuing another blind request.
    if (!querying) markRefund(id, { status: 'processing' }, actor);
    try {
      let result = querying ? await provider.refundQuery(params) : await provider.refund(params);
      if (querying && result.status === 'not_found') result = { status: 'pending' };
      // An unsuccessful query is not proof that the original request failed.
      else if (querying && result.status === 'error') result = { ...result, status: 'processing' };
      return markRefund(id, result, actor, !querying && result.status === 'error' ? 1 : 0);
    } catch (err) {
      return markRefund(id, { status: 'processing', error: err.message }, actor, querying ? 0 : 1);
    }
  }

  async function runRefund(refund, actor = 'system') {
    if (refunding.has(refund.id)) return refunding.get(refund.id);
    const task = settleRefund(refund.id, actor);
    refunding.set(refund.id, task);
    try { return await task; } finally { refunding.delete(refund.id); }
  }

  async function retryRefund(id) {
    const refunds = store.all("select * from refunds where order_id = ? and status != 'success'", id);
    if (!refunds.length) throw new UserError('这个订单没有待处理的退款', 409);
    for (const refund of refunds) {
      if (refund.status === 'error') store.run("update refunds set status = 'pending' where id = ?", refund.id);
      await runRefund(store.get('select * from refunds where id = ?', refund.id), 'admin');
    }
    return getOrder(id);
  }

  function adminList({ status = '', q = '', page = 1 }) {
    const where = [];
    const args = [];
    if (status === 'refund') where.push("refund_status is not null and refund_status != 'success'");
    else if (status) { where.push('status = ?'); args.push(status); }
    const query = String(q).trim().toUpperCase();
    if (query) { where.push('(id like ? or upper(code_tail) = ? or id in (select order_id from external_orders where reference_hash = ?))'); args.push(`%${query}%`, query.slice(-4), fingerprint(config.secret, `taobao:${String(q).trim()}`)); }
    const sql = `from orders${where.length ? ` where ${where.join(' and ')}` : ''}`;
    const size = 30;
    const total = store.get(`select count(*) as n ${sql}`, ...args).n;
    const rows = store.all(`select * ${sql} order by created_at desc limit ${size} offset ?`, ...args, (Math.max(1, page) - 1) * size);
    return { total, page, size, items: rows.map(o => adminRow(o)) };
  }

  const adminRow = o => ({
    id: o.id, status: o.status, code: maskTail(o.code_tail), showPublic: !!o.show_public, createdAt: o.created_at, paidAt: o.paid_at,
    dueAt: o.due_at, decidedAt: o.decided_at, refundStatus: o.refund_status, refundDueAt: o.refund_due_at, reason: o.reason,
    external: externalView(o),
  });

  function adminDetail(id) {
    const o = getOrder(id);
    if (!o) throw new UserError('找不到这个订单', 404);
    let code = null;
    if (o.code_sealed) {
      try { code = openCode(config.secret, o.code_sealed); } catch { code = null; }
    }
    const repeats = store.get('select count(*) as n from orders where code_fp = ? and id != ?', o.code_fp, id).n;
    return {
      ...adminRow(o), code, codePurged: !!o.purged_at, repeats,
      external: external(id)?.source === 'taobao' ? { ...externalView(o), reference: openCode(config.secret, external(id).reference_sealed), checkNote: external(id).check_note, refundNote: external(id).refund_note } : externalView(o),
      payments: store.all('select id, channel, status, amount, trade_no as tradeNo, created_at as createdAt, paid_at as paidAt from payments where order_id = ? order by created_at', id),
      refunds: store.all('select id, kind, channel, amount, status, error, attempts, updated_at as updatedAt from refunds where order_id = ? order by created_at', id),
      events: store.all('select at, actor, kind, detail from events where order_id = ? order by id desc limit 50', id),
    };
  }

  function stats() {
    const t = now();
    const day = beijingDayStart(t);
    const count = (sql, ...args) => store.get(`select count(*) as n from orders where ${sql}`, ...args).n;
    return {
      unpaid: count("status = 'unpaid'"),
      submitted: count("status = 'submitted'"),
      reviewing: count("status = 'reviewing'"),
      overdue: count("status = 'reviewing' and due_at < ?", t),
      passedToday: count("status = 'passed' and decided_at >= ?", day),
      failedToday: count("status = 'failed' and decided_at >= ?", day),
      refunding: count("refund_status is not null and refund_status != 'success'"),
      refundOverdue: count("refund_status is not null and refund_status != 'success' and refund_due_at < ?", t),
      total: count('1 = 1'),
    };
  }

  /* ---------- background work ---------- */
  async function tick() {
    const t = now();
    // QR expiry is not proof that no money moved. Old or legacy closed records
    // remain queryable until the platform confirms a terminal status; slow the
    // oldest unresolved payments to hourly queries without abandoning them.
    for (const payment of store.all("select * from payments where (status = 'pending' or (status = 'closed' and reconciled_at is null)) and (checked_at is null or checked_at < ? - case when created_at < ? then ? else ? end) order by coalesce(checked_at, 0), created_at limit 100", t, t - 24 * HOUR, HOUR, MINUTE)) {
      await syncPayment(payment, { force: true });
    }
    for (const o of store.all("select id from orders where status = 'unpaid' and created_at < ?", t - 24 * HOUR)) {
      store.run("update orders set status = 'expired' where id = ? and status = 'unpaid'", o.id);
      event(o.id, 'system', 'expired');
    }
    // Failed refunds are retried with a growing pause (10 min, 20 min … at most hourly), without a cap.
    for (const refund of store.all("select * from refunds where status in ('pending', 'processing') or (status = 'error' and updated_at < ? - min(attempts * 10, 60) * 60000)", t)) {
      await runRefund(refund);
    }
    // Codes are secrets: drop them once an order is settled.
    const cutoff = t - VERIFY.purgeDays * 24 * HOUR;
    // Unchecked intake must not retain credentials indefinitely.
    for (const o of store.all("select id from orders where status = 'submitted' and created_at < ?", cutoff)) {
      store.transaction(() => {
        store.run("update orders set status = 'rejected', reason = ?, decided_at = ?, code_sealed = null, purged_at = ? where id = ?", '资料待核对超过 7 天，已关闭并清除完整 Session Key；请通过淘宝原订单联系商家核实。', t, t, o.id);
        event(o.id, 'system', 'external_expired');
      });
    }
    for (const o of store.all("select id from orders where code_sealed is not null and ((decided_at is not null and decided_at < ?) or (status = 'expired' and created_at < ?))", cutoff, cutoff)) {
      store.run('update orders set code_sealed = null, purged_at = ? where id = ?', t, o.id);
      event(o.id, 'system', 'code_purged');
    }
    store.db.exec('pragma wal_checkpoint(truncate)');
    store.run('delete from sessions where expires_at < ?', t);
  }

  return { createOrder, createSessionOrder, createExternalOrder, checkExternalOrder, recordExternalRefund, acceptingExternalOrders, requestPayment, lookup, feed, markPaid, markRefund, syncPayment, decide, retryRefund, runRefund, adminList, adminDetail, stats, tick, channels, acceptingNewOrders, sha256, event };
}
