// The support destination is public business contact data. Never append order
// access tokens, Session Keys or private query links to an external URL.
export function qqSupportContact(value) {
  const qq = String(value || '').trim();
  if (!/^[1-9]\d{4,11}$/.test(qq)) return null;
  const url = new URL('https://wpa.qq.com/msgrd');
  url.search = new URLSearchParams({ v: '3', uin: qq, site: 'qq', menu: 'yes' }).toString();
  return { qq, href: url.href };
}

export function orderSupportVisible(order, now) {
  if (!order) return false;
  const completed = ['passed', 'failed', 'rejected', 'expired'].includes(order.status);
  return completed || (Number.isFinite(order.dueAt) && order.dueAt > 0 && now >= order.dueAt);
}
