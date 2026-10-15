// Fees, timings and the code format for /verify/. Shared by the page, the build and the API
// (server/verify), so the amounts shown before payment are the amounts charged.
export const VERIFY = Object.freeze({
  open: false, // false: the navigation and page say 即将开放. Set true once live payments work, then rebuild.
  techFeeMinor: 3000, // 人工技术费 ¥30, never refunded
  auditFeeMinor: 30000, // 审核费 ¥300, refunded when the review fails
  reviewHours: 24, // expected review time; drives the countdown only
  refundHours: 24, // the audit fee goes back within this window after a failed review
  paymentMinutes: 15, // a payment QR code stays valid this long
  purgeDays: 7, // submitted codes are deleted this many days after the result
  codeMin: 40,
  codeMax: 120,
});

export const totalMinor = () => VERIFY.techFeeMinor + VERIFY.auditFeeMinor;
export const yuan = minor => `¥${(minor / 100).toFixed(2).replace(/\.00$/, '')}`;

// Pasted codes often carry spaces or line breaks; they are never part of the code.
export const normalizeCode = value => String(value ?? '').replace(/\s+/g, '');

// Returns null when the code is acceptable, otherwise a message for the person typing it.
export function codeProblem(code) {
  if (!code) return '请填写 Session Key';
  if (!code.startsWith('sk')) return 'Session Key 应以 sk 开头，请核对完整值';
  if (!/^[A-Za-z0-9_-]+$/.test(code)) return 'Session Key 只能包含字母、数字、- 和 _';
  if (code.length < VERIFY.codeMin) return `Session Key 太短，请确认是否完整（至少 ${VERIFY.codeMin} 位）`;
  if (code.length > VERIFY.codeMax) return `Session Key 太长，请确认是否多复制了内容（最多 ${VERIFY.codeMax} 位）`;
  return null;
}

// sk••••7KQ2: enough to recognise your own code, useless to anyone else.
export const maskTail = tail => `sk••••${tail}`;

export const ORDER_PATTERN = /^GT-VF-\d{4}-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/;

export const STATUS_NAMES = Object.freeze({
  unpaid: '待付款',
  expired: '已过期',
  reviewing: '审核中',
  passed: '已通过',
  failed: '未通过',
});
export const REFUND_NAMES = Object.freeze({
  pending: '退款中',
  processing: '退款中',
  success: '已退回',
  error: '退款处理中',
});
