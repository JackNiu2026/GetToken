// Order lifecycle. Results come only from decide(), which only the admin API calls:
// nothing here passes or fails an order on a timer.
import { VERIFY, totalMinor, codeProblem, normalizeCode, maskTail } from '../../assets/gettoken/verify-rules.mjs';
import { orderId, compactId, sealCode, openCode, fingerprint, sha256, beijingDayStart } from './secure.mjs';

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
  const providerFor = channel => {
    if (!Object.hasOwn(providers, channel)) throw new UserError('不支持的付款方式');
    return providers[channel];
  };

  /* ---------- payments ---------- */
  async function openPayment(order, channel) {
    const provider = providerFor(channel);
    const t = now();
    const existing = store.get("select * from payments where order_id = ? and channel = ? and status = 'pending' and expires_at > ? order by created_at desc limit 1", order.id, channel, t + MINUTE);
    if (existing) return existing;
    const attempt = store.get('select count(*) as n from payments where order_id = ?', order.id).n + 1;
    if (attempt > 12) throw new UserError('付款二维码获取次数过多，请重新提交订单', 429);
    const id = `${compactId(order.id)}P${attempt}`;
    const amount = order.tech_fee + order.audit_fee;
    const expiresAt = t + VERIFY.paymentMinutes * MINUTE;
    const { qr } = await provider.precreate({ outTradeNo: id, amountMinor: amount, subject: `GetToken 审核验证 ${order.id}`, expiresAt });
    store.run("insert into payments(id, order_id, channel, status, amount, qr, created_at, expires_at) values(?, ?, ?, 'pending', ?, ?, ?, ?)", id, order.id, channel, amount, qr, t, expiresAt);
    event(order.id, 'system', 'payment_opened', `${channel} ${id}`);
    return store.get('select * from payments where id = ?', id);
  }

  // Called from a verified payment notification or a verified query result.
  function markPaid(paymentId, { tradeNo, amountMinor }) {
    const known = store.get('select * from payments where id = ?', paymentId);
    if (!known) throw new Error(`Unknown payment ${paymentId}`);
    if (amountMinor !== known.amount) {
      event(known.order_id, 'system', 'payment_amount_mismatch', `${paymentId} ${amountMinor} != ${known.amount}`);
      throw new Error(`Amount mismatch for ${paymentId}`);
    }
    return store.transaction(() => {
      const payment = store.get('select * from payments where id = ?', paymentId);
      if (payment.status === 'paid' || payment.status === 'duplicate') return payment;
      const t = now();
      const order = getOrder(payment.order_id);
      const first = order.status === 'unpaid' || order.status === 'expired';
      store.run('update payments set status = ?, trade_no = ?, paid_at = ? where id = ?', first ? 'paid' : 'duplicate', tradeNo || null, t, paymentId);
      if (first) {
        store.run("update orders set status = 'reviewing', paid_at = ?, due_at = ?, paid_payment = ? where id = ?", t, t + VERIFY.reviewHours * HOUR, paymentId, order.id);
        store.run("update payments set status = 'closed' where order_id = ? and status = 'pending'", order.id);
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

  async function syncPayment(payment, { force = false } = {}) {
    if (payment.status !== 'pending' || !Object.hasOwn(providers, payment.channel)) return payment;
    const t = now();
    if (!force && payment.checked_at && t - payment.checked_at < 5000) return payment;
    store.run('update payments set checked_at = ? where id = ?', t, payment.id);
    try {
      const result = await providers[payment.channel].query(payment.id);
      if (result.paid) return markPaid(payment.id, result);
    } catch (error) {
      log(`payment query ${payment.id}: ${error.message}`);
    }
    return payment;
  }

  /* ---------- public API ---------- */
  async function createOrder({ code: raw, showPublic, agree, channel, ip }) {
    if (!channels().length) throw new UserError('在线支付暂未开通，请稍后再来', 503);
    const code = normalizeCode(raw);
    const problem = codeProblem(code);
    if (problem) throw new UserError(problem);
    if (agree !== true) throw new UserError('请先确认费用与退款规则');
    providerFor(channel);
    const t = now();
    let id;
    do id = orderId(t); while (getOrder(id));
    store.run("insert into orders(id, code_sealed, code_tail, code_fp, show_public, status, tech_fee, audit_fee, created_at, ip_hash) values(?, ?, ?, ?, ?, 'unpaid', ?, ?, ?, ?)",
      id, sealCode(config.secret, code), code.slice(-4), fingerprint(config.secret, code), showPublic === true ? 1 : 0, VERIFY.techFeeMinor, VERIFY.auditFeeMinor, t, ip ? fingerprint(config.secret, `ip:${ip}`) : null);
    event(id, 'user', 'created', showPublic === true ? '同意匿名展示' : null);
    try {
      await openPayment(getOrder(id), channel);
    } catch (error) {
      log(`precreate ${id}: ${error.message}`);
      event(id, 'system', 'payment_error', error.message.slice(0, 300));
      if (error instanceof UserError) throw error;
      throw new UserError('付款二维码获取失败，请稍后重试或换一种付款方式', 502);
    }
    return view(getOrder(id));
  }

  async function requestPayment(id, channel) {
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
    if (order.status === 'unpaid') {
      for (const payment of store.all("select * from payments where order_id = ? and status = 'pending'", id)) await syncPayment(payment);
      order = getOrder(id);
    }
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
    };
    if (order.status === 'failed') {
      out.reason = order.reason || null;
      out.refund = { status: order.refund_status, amount: order.audit_fee, dueAt: order.refund_due_at, refundedAt: order.refunded_at };
    }
    if (order.status === 'unpaid') {
      const pending = store.all("select * from payments where order_id = ? and status = 'pending' and expires_at > ? order by created_at desc", order.id, t);
      const payment = pending.find(p => p.channel === channel) || pending[0];
      out.payment = payment ? { id: payment.id, channel: payment.channel, qr: payment.qr, amount: payment.amount, expiresAt: payment.expires_at } : null;
    }
    return out;
  }

  function feed() {
    const t = now();
    const day = beijingDayStart(t);
    const counts = store.get("select count(*) as processed, coalesce(sum(status = 'passed'), 0) as passed from orders where decided_at >= ?", day);
    const items = store.all("select code_tail, decided_at from orders where status = 'passed' and show_public = 1 order by decided_at desc limit 20")
      .map(row => ({ code: maskTail(row.code_tail), at: row.decided_at }));
    return { now: t, today: { processed: counts.processed, passed: counts.passed }, items };
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
      const t = now();
      if (result === 'passed') {
        store.run("update orders set status = 'passed', decided_at = ?, reason = null where id = ?", t, id);
      } else {
        const payment = store.get('select * from payments where id = ?', order.paid_payment);
        store.run("update orders set status = 'failed', decided_at = ?, reason = ?, refund_status = 'pending', refund_due_at = ? where id = ?", t, note, t + REFUND_DUE, id);
        store.run("insert into refunds(id, order_id, payment_id, channel, kind, amount, status, created_at, updated_at) values(?, ?, ?, ?, 'audit', ?, 'pending', ?, ?)",
          `${compactId(id)}R1`, id, payment.id, payment.channel, order.audit_fee, t, t);
      }
      event(id, actor, result, note);
    });
    return getOrder(id);
  }

  async function runRefund(refund, actor = 'system') {
    const provider = providers[refund.channel];
    if (!provider) return refund;
    const payment = store.get('select * from payments where id = ?', refund.payment_id);
    const t = now();
    const querying = refund.status === 'processing';
    let status;
    let error = null;
    try {
      const result = querying
        ? await provider.refundQuery({ outTradeNo: payment.id, refundId: refund.id })
        : await provider.refund({ outTradeNo: payment.id, refundId: refund.id, amountMinor: refund.amount, totalMinor: payment.amount, reason: refund.kind === 'audit' ? '审核未通过，退回审核费' : '重复付款退回' });
      status = result.status;
      error = result.error || null;
    } catch (err) {
      // A failed status check says nothing about the refund itself: keep checking.
      status = querying ? 'processing' : 'error';
      error = err.message.slice(0, 300);
    }
    // Only failed refund requests count as attempts; status checks of a processing refund do not.
    const failed = status === 'error' ? 1 : 0;
    store.transaction(() => {
      store.run('update refunds set status = ?, error = ?, attempts = attempts + ?, updated_at = ? where id = ?', status, error, failed, t, refund.id);
      if (refund.kind === 'audit') {
        store.run('update orders set refund_status = ?, refunded_at = ? where id = ?', status, status === 'success' ? t : null, refund.order_id);
      }
      if (status !== refund.status || (error && !querying)) event(refund.order_id, actor, `refund_${status}`, `${refund.kind} ${refund.id}${error ? ` · ${error}` : ''}`);
    });
    return store.get('select * from refunds where id = ?', refund.id);
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
    if (query) { where.push('(id like ? or upper(code_tail) = ?)'); args.push(`%${query}%`, query.slice(-4)); }
    const sql = `from orders${where.length ? ` where ${where.join(' and ')}` : ''}`;
    const size = 30;
    const total = store.get(`select count(*) as n ${sql}`, ...args).n;
    const rows = store.all(`select * ${sql} order by created_at desc limit ${size} offset ?`, ...args, (Math.max(1, page) - 1) * size);
    return { total, page, size, items: rows.map(o => adminRow(o)) };
  }

  const adminRow = o => ({
    id: o.id, status: o.status, code: maskTail(o.code_tail), showPublic: !!o.show_public, createdAt: o.created_at, paidAt: o.paid_at,
    dueAt: o.due_at, decidedAt: o.decided_at, refundStatus: o.refund_status, refundDueAt: o.refund_due_at, reason: o.reason,
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
    for (const payment of store.all("select * from payments where status = 'pending' and created_at > ? and (checked_at is null or checked_at < ?)", t - 30 * MINUTE, t - MINUTE)) {
      await syncPayment(payment, { force: true });
    }
    store.run("update payments set status = 'closed' where status = 'pending' and expires_at < ?", t - 30 * MINUTE);
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
    for (const o of store.all("select id from orders where code_sealed is not null and ((decided_at is not null and decided_at < ?) or (status = 'expired' and created_at < ?))", cutoff, cutoff)) {
      store.run('update orders set code_sealed = null, purged_at = ? where id = ?', t, o.id);
      event(o.id, 'system', 'code_purged');
    }
    store.run('delete from sessions where expires_at < ?', t);
  }

  return { createOrder, requestPayment, lookup, feed, markPaid, syncPayment, decide, retryRefund, runRefund, adminList, adminDetail, stats, tick, channels, sha256, event };
}
