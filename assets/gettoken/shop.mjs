// Shared storefront behaviour for the homepage and product pages: toast, copy,
// contact details, the order/contact dialog and the payment dialog.
// Everything is page-local: no requests, no storage, no real orders.
import { formatMoney, createPaymentReference } from './catalog.mjs';
import { SITE } from './site.config.mjs';

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

// Configured image paths are relative to the site root, whichever page loads this module.
const SITE_ROOT = new URL('../../', import.meta.url);
const siteAsset = path => new URL(path, SITE_ROOT).href;

/* ---------- Toast ---------- */
const toast = $('[data-toast]');
let toastTimer = 0;
export function showToast(message) {
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('is-shown');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('is-shown'), 2200);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const field = document.createElement('textarea');
    field.value = text;
    field.setAttribute('readonly', '');
    field.style.position = 'fixed';
    field.style.opacity = '0';
    document.body.append(field);
    field.select();
    document.execCommand('copy');
    field.remove();
  }
  showToast(`已复制：${text}`);
}

/* ---------- Dialogs ---------- */
const dialogTriggers = new WeakMap();
let beforeOpen = () => {};
export function onBeforeDialog(callback) { beforeOpen = callback; }

export function openDialog(dialog, trigger) {
  beforeOpen();
  dialogTriggers.set(dialog, trigger);
  dialog.showModal();
}
function registerDialog(dialog) {
  if (!dialog) return;
  $$('[data-close-dialog]', dialog).forEach(button => button.addEventListener('click', () => dialog.close()));
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close();
  });
  dialog.addEventListener('close', () => {
    const trigger = dialogTriggers.get(dialog);
    if (trigger?.getClientRects().length) trigger.focus({ preventScroll: true });
  });
}

function renderContact(container, intro) {
  if (!container) return;
  container.replaceChildren();
  const { wechat, wechatQr, telegram, email } = SITE.contact;
  if (wechatQr) {
    const figure = document.createElement('figure');
    figure.className = 'contact-qr';
    const img = new Image();
    img.src = siteAsset(wechatQr);
    img.alt = '客服微信二维码';
    img.width = 160;
    img.height = 160;
    img.addEventListener('error', () => figure.remove(), { once: true });
    const caption = document.createElement('figcaption');
    caption.textContent = '微信扫码添加客服';
    figure.append(img, caption);
    container.append(figure);
  }
  const entries = [['微信', wechat], ['Telegram', telegram], ['邮箱', email]].filter(([, value]) => value);
  if (!entries.length && !wechatQr) {
    const empty = document.createElement('p');
    empty.className = 'contact-empty';
    empty.textContent = '客服联系方式即将公布';
    container.append(empty);
    return;
  }
  if (entries.length) {
    const lead = document.createElement('p');
    lead.textContent = intro;
    container.append(lead);
  }
  for (const [label, value] of entries) {
    const row = document.createElement('div');
    row.className = 'contact-row';
    const name = document.createElement('span');
    name.textContent = label;
    const text = document.createElement('b');
    text.textContent = value;
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.textContent = '复制';
    copy.addEventListener('click', () => copyText(value));
    row.append(name, text, copy);
    container.append(row);
  }
}

const queryDialog = $('#query-dialog');
registerDialog(queryDialog);
renderContact($('[data-query-contact]'), '把你的需求或付款备注码发给客服');
$$('[data-open-query]').forEach(button => button.addEventListener('click', () => openDialog(queryDialog, button)));

/* ---------- Payment dialog ---------- */
const payDialog = $('#pay-dialog');
registerDialog(payDialog);
const pay = payDialog && {
  title: $('[data-pay-title]', payDialog),
  list: $('[data-pay-list]', payDialog),
  ref: $('[data-pay-ref]', payDialog),
  methods: $('[data-pay-methods]', payDialog),
  qr: $('[data-pay-qr]', payDialog),
  amount: $('[data-pay-amount]', payDialog),
  amountNote: $('[data-pay-amount-note]', payDialog),
};
if (pay) {
  renderContact($('[data-pay-contact]', payDialog), '付款后，把截图和备注码发给客服');
  $('[data-copy-ref]', payDialog).addEventListener('click', () => copyText(pay.ref.textContent));
  pay.methods.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    const tabs = $$('button', pay.methods);
    const i = tabs.indexOf(document.activeElement);
    if (i < 0) return;
    const next = tabs[(i + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
    next.click();
    next.focus();
  });
}

function qrPlaceholder(label) {
  const box = document.createElement('div');
  box.className = 'qr-placeholder';
  box.innerHTML = '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="6" y="6" width="14" height="14" rx="2"/><rect x="28" y="6" width="14" height="14" rx="2"/><rect x="6" y="28" width="14" height="14" rx="2"/><path d="M28 28h6v6h-6zM38 38h4v4h-4zM28 40h4M40 28v6"/></svg>';
  const title = document.createElement('b');
  title.textContent = `${label}收款码`;
  const note = document.createElement('span');
  note.textContent = '收款码待上传';
  box.append(title, note);
  return box;
}

function showMethod(method) {
  $$('button', pay.methods).forEach(b => {
    const selected = b.dataset.method === method.key;
    b.setAttribute('aria-selected', String(selected));
    b.tabIndex = selected ? 0 : -1;
  });
  pay.qr.replaceChildren();
  pay.qr.setAttribute('aria-label', `${method.label}收款码`);
  if (method.qr) {
    const img = new Image();
    img.src = siteAsset(method.qr);
    img.alt = `${method.label}收款码`;
    img.addEventListener('error', () => pay.qr.replaceChildren(qrPlaceholder(method.label)), { once: true });
    pay.qr.append(img);
  } else {
    pay.qr.append(qrPlaceholder(method.label));
  }
}

export function openPayment(quote, trigger) {
  if (!pay) return;
  const methods = SITE.payment.methods.filter(m => m.currencies.includes(quote.currency));
  const available = methods.length ? methods : SITE.payment.methods;
  pay.title.textContent = `${quote.name} · ${quote.tierName}`;
  const rows = [
    ['方案', `${quote.tierName} · ${quote.tierHint}`],
    ...(quote.deliveryName ? [['交付方式', quote.deliveryName]] : []),
    ['服务周期', `${quote.months} 个月`],
    ['月度价格', `${formatMoney(quote.monthlyMinor, quote.currency)} / 月`],
  ];
  if (quote.savingMinor > 0) rows.push(['周期优惠', `−${formatMoney(quote.savingMinor, quote.currency)}`]);
  rows.push(['合计', formatMoney(quote.totalMinor, quote.currency)]);
  pay.list.replaceChildren(...rows.map(([k, v], i) => {
    const row = document.createElement('div');
    if (i === rows.length - 1) row.className = 'is-total';
    const dt = document.createElement('dt');
    dt.textContent = k;
    const dd = document.createElement('dd');
    dd.textContent = v;
    row.append(dt, dd);
    return row;
  }));
  pay.ref.textContent = createPaymentReference(quote);
  pay.amount.textContent = formatMoney(quote.totalMinor, quote.currency);
  pay.amountNote.textContent = quote.totalMinor === null ? '价格即将公布，金额以客服确认为准' : `币种 ${quote.currency}，请按此金额付款`;
  pay.methods.replaceChildren(...available.map(method => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.dataset.method = method.key;
    b.textContent = method.label;
    b.addEventListener('click', () => showMethod(method));
    return b;
  }));
  showMethod(available[0]);
  openDialog(payDialog, trigger);
}
