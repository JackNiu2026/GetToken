// Shared storefront behaviour for the homepage and product pages: toast, copy,
// contact details, the order/contact dialog and the payment dialog.
// Everything is page-local: no requests, no storage, no real orders.
import { contactReady, inquiryState, inquirySummary } from './inquiry.mjs';
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
    empty.textContent = '客服尚未开放，当前不受理新咨询或付款。';
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
const contactIntro = () => contactReady() ? `${SITE.support.identity} · 支持时段：${SITE.support.hours}（${SITE.support.timeZone}）。请说明需求，不要发送密码或 Session Key。` : '当前不受理新咨询或付款。';
renderContact($('[data-query-contact]'), contactIntro());
$$('[data-open-query]').forEach(button => button.addEventListener('click', () => { $('#query-title').textContent = '服务咨询'; $('.sheet__text', queryDialog).textContent = contactIntro(); openDialog(queryDialog, button); }));

// Preserve the existing exported name for product-page callers; ordinary products
// now use the existing contact dialog and never create a payment or pseudo-order.
export function openPayment(quote, trigger) {
  if (!queryDialog) return;
  const availability = inquiryState(quote.product, quote.tier, quote.months);
  $('#query-title').textContent = `${quote.name} · ${availability.label}`;
  $('.sheet__text', queryDialog).textContent = `${inquirySummary(quote)} ${availability.message}`;
  renderContact($('[data-query-contact]'), contactIntro());
  openDialog(queryDialog, trigger);
}
