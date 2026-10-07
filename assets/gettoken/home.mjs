import { PRODUCTS, getQuote, formatMoney, createPaymentReference } from './catalog.mjs';
import { SITE } from './site.config.mjs';
import {
  reduceMotion, onScroll, initSplit, initReveal, initCounters, initChrome,
  initConsoleTilt, initSteps, initScrollSpy,
} from './motion.mjs';
import { initEarth } from './scenes.mjs';

// Everything here is page-local: no requests, no storage, no real orders.
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const header = $('.site-header');
const menuToggle = $('.menu-toggle');
const mobileNav = $('#mobile-nav');
const productNav = $('.nav-products');
const payDialog = $('#pay-dialog');
const queryDialog = $('#query-dialog');
const toast = $('[data-toast]');
const drawerViewport = window.matchMedia('(max-width: 960px)');
const mobileViewport = window.matchMedia('(max-width: 640px)');

/* ---------- Toast ---------- */
let toastTimer = 0;
function showToast(message) {
  toast.textContent = message;
  toast.classList.add('is-shown');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('is-shown'), 2200);
}

async function copyText(text) {
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

/* ---------- Navigation ---------- */
function closeMenu() {
  mobileNav.hidden = true;
  menuToggle.setAttribute('aria-expanded', 'false');
  menuToggle.setAttribute('aria-label', '打开菜单');
}
menuToggle.addEventListener('click', () => {
  const open = mobileNav.hidden;
  mobileNav.hidden = !open;
  menuToggle.setAttribute('aria-expanded', String(open));
  menuToggle.setAttribute('aria-label', open ? '关闭菜单' : '打开菜单');
});
$$('a', mobileNav).forEach(link => link.addEventListener('click', closeMenu));
$$('a', productNav).forEach(link => link.addEventListener('click', () => { productNav.open = false; }));
document.addEventListener('click', event => {
  if (!productNav.contains(event.target)) productNav.open = false;
});
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  if (productNav.open) {
    productNav.open = false;
    $('summary', productNav).focus();
  }
  if (!mobileNav.hidden) {
    closeMenu();
    menuToggle.focus();
  }
});
drawerViewport.addEventListener('change', () => { if (!drawerViewport.matches) closeMenu(); });

/* ---------- Dialogs ---------- */
const dialogTriggers = new WeakMap();
function openDialog(dialog, trigger) {
  closeMenu();
  productNav.open = false;
  dialogTriggers.set(dialog, trigger);
  dialog.showModal();
}
for (const dialog of [payDialog, queryDialog]) {
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

function renderContact(container) {
  container.replaceChildren();
  const entries = [
    ['微信', SITE.contact.wechat],
    ['Telegram', SITE.contact.telegram],
    ['邮箱', SITE.contact.email],
  ].filter(([, value]) => value);
  if (!entries.length) {
    const empty = document.createElement('p');
    empty.className = 'contact-empty';
    empty.textContent = '客服联系方式即将公布';
    container.append(empty);
    return;
  }
  const intro = document.createElement('p');
  intro.textContent = '付款后，把截图和备注码发给客服';
  container.append(intro);
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
renderContact($('[data-query-contact]'));
$$('[data-open-query]').forEach(button => button.addEventListener('click', () => openDialog(queryDialog, button)));

/* ---------- Payment dialog ---------- */
const payTitle = $('[data-pay-title]', payDialog);
const payList = $('[data-pay-list]', payDialog);
const payRef = $('[data-pay-ref]', payDialog);
const payMethods = $('[data-pay-methods]', payDialog);
const payQr = $('[data-pay-qr]', payDialog);
const payAmount = $('[data-pay-amount]', payDialog);
const payAmountNote = $('[data-pay-amount-note]', payDialog);
const PERIOD_NAMES = { 1: '月付', 3: '季付', 12: '年付' };
renderContact($('[data-pay-contact]', payDialog));
$('[data-copy-ref]', payDialog).addEventListener('click', () => copyText(payRef.textContent));

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
  $$('button', payMethods).forEach(b => {
    const selected = b.dataset.method === method.key;
    b.setAttribute('aria-selected', String(selected));
    b.tabIndex = selected ? 0 : -1;
  });
  payQr.replaceChildren();
  payQr.setAttribute('aria-label', `${method.label}收款码`);
  if (method.qr) {
    const img = new Image();
    img.src = method.qr;
    img.alt = `${method.label}收款码`;
    img.addEventListener('error', () => payQr.replaceChildren(qrPlaceholder(method.label)), { once: true });
    payQr.append(img);
  } else {
    payQr.append(qrPlaceholder(method.label));
  }
}

function openPayment(quote, trigger) {
  const methods = SITE.payment.methods.filter(m => m.currencies.includes(quote.currency));
  const available = methods.length ? methods : SITE.payment.methods;
  payTitle.textContent = `${quote.name} · ${quote.tierName}`;
  const rows = [
    ['方案', `${quote.tierName} · ${quote.tierHint}`],
    ['服务周期', `${quote.months} 个月`],
    ['月度价格', `${formatMoney(quote.monthlyMinor, quote.currency)} / 月`],
  ];
  if (quote.savingMinor > 0) rows.push(['周期优惠', `−${formatMoney(quote.savingMinor, quote.currency)}`]);
  rows.push(['合计', formatMoney(quote.totalMinor, quote.currency)]);
  payList.replaceChildren(...rows.map(([k, v], i) => {
    const row = document.createElement('div');
    if (i === rows.length - 1) row.className = 'is-total';
    const dt = document.createElement('dt');
    dt.textContent = k;
    const dd = document.createElement('dd');
    dd.textContent = v;
    row.append(dt, dd);
    return row;
  }));
  payRef.textContent = createPaymentReference(quote);
  payAmount.textContent = formatMoney(quote.totalMinor, quote.currency);
  payAmountNote.textContent = quote.totalMinor === null ? '价格即将公布，金额以客服确认为准' : `币种 ${quote.currency}，请按此金额付款`;
  payMethods.replaceChildren(...available.map(method => {
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
payMethods.addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
  const tabs = $$('button', payMethods);
  const i = tabs.indexOf(document.activeElement);
  if (i < 0) return;
  const next = tabs[(i + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
  next.click();
  next.focus();
});

/* ---------- Pricing cards ---------- */
const plans = new Map();

function animateValue(el, from, to, currency) {
  if (reduceMotion.matches || from === to || from === null || to === null) {
    el.textContent = formatMoney(to, currency);
    return;
  }
  const step = currency === 'CNY' ? 100 : 1;
  const start = performance.now();
  const dur = 520;
  const tick = now => {
    const p = Math.min(1, (now - start) / dur);
    const eased = 1 - Math.pow(1 - p, 3);
    const value = Math.round((from + (to - from) * eased) / step) * step;
    el.textContent = formatMoney(p === 1 ? to : value, currency);
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

$$('[data-product]').forEach(card => {
  const product = card.dataset.product;
  const priceEl = $('[data-price]', card);
  const totalEl = $('[data-total]', card);
  const featuresEl = $('[data-features]', card);
  let shownMonthly;
  let shownTier = null;

  const read = () => ({
    tier: $(`input[name="${product}-tier"]:checked`, card).value,
    months: Number($(`input[name="${product}-period"]:checked`, card).value),
  });

  function render() {
    const { tier, months } = read();
    const quote = getQuote(product, tier, months);
    animateValue(priceEl, shownMonthly === undefined ? quote.monthlyMinor : shownMonthly, quote.monthlyMinor, quote.currency);
    shownMonthly = quote.monthlyMinor;
    totalEl.textContent = `${PERIOD_NAMES[months]} · ${months} 个月合计 ${formatMoney(quote.totalMinor, quote.currency)}`;
    if (quote.savingMinor > 0) {
      const saving = document.createElement('b');
      saving.textContent = ` 省 ${formatMoney(quote.savingMinor, quote.currency)}`;
      totalEl.append(saving);
    }
    if (shownTier !== null && shownTier !== tier) {
      featuresEl.replaceChildren(...quote.features.map(text => {
        const li = document.createElement('li');
        li.textContent = text;
        return li;
      }));
      featuresEl.classList.remove('is-swapping');
      void featuresEl.offsetWidth;
      featuresEl.classList.add('is-swapping');
    }
    shownTier = tier;
    return quote;
  }

  card.addEventListener('change', event => { if (event.target.matches('input[type="radio"]')) render(); });
  $('[data-buy]', card).addEventListener('click', event => {
    const quote = render();
    openPayment(quote, event.currentTarget);
  });

  plans.set(product, {
    card,
    set(tier, months) {
      const t = $(`input[name="${product}-tier"][value="${tier}"]`, card);
      const m = $(`input[name="${product}-period"][value="${months}"]`, card);
      if (t) t.checked = true;
      if (m) m.checked = true;
      render();
    },
  });
  render();
});

/* Presets from tier and scene buttons: "product:tier:months,…" */
function applyPreset(spec) {
  const entries = spec.split(',').map(s => s.trim().split(':'));
  const cards = [];
  for (const [product, tier, months] of entries) {
    const plan = plans.get(product);
    if (!plan) continue;
    plan.set(tier, Number(months));
    cards.push(plan.card);
  }
  if (!cards.length) return;
  cards[0].scrollIntoView({ behavior: reduceMotion.matches ? 'auto' : 'smooth', block: 'start' });
  cards.forEach(card => {
    card.classList.remove('is-highlight');
    void card.offsetWidth;
    card.classList.add('is-highlight');
  });
  const names = entries.map(([p]) => plans.has(p) && PRODUCTS[p].name).filter(Boolean);
  showToast(`已为你配置：${names.join(' + ')}`);
}
$$('[data-preset]').forEach(el => el.addEventListener('click', event => {
  event.preventDefault();
  applyPreset(el.dataset.preset);
}));

/* ---------- Hero product console ---------- */
function initConsole(root) {
  if (!root) return;
  const tabs = $$('[role="tab"]', root);
  const panels = tabs.map(tab => document.getElementById(tab.getAttribute('aria-controls')));
  const cycle = 6000;
  root.style.setProperty('--cycle', `${cycle}ms`);
  let index = 0;
  let timer = 0;
  let typeTimers = [];
  let inView = true;

  function type(panel) {
    typeTimers.forEach(clearTimeout);
    typeTimers = [];
    const typer = $('[data-typer]', panel);
    if (!typer || reduceMotion.matches) return;
    const items = Array.from(typer.children);
    typer.classList.add('is-typing');
    items.forEach(item => item.classList.remove('is-typed'));
    items.forEach((item, i) => {
      typeTimers.push(setTimeout(() => item.classList.add('is-typed'), 250 + i * 420));
    });
  }

  function select(i, { focus = false } = {}) {
    index = (i + tabs.length) % tabs.length;
    tabs.forEach((tab, k) => {
      const on = k === index;
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
      panels[k].hidden = !on;
      panels[k].classList.toggle('is-active', on);
    });
    if (focus) tabs[index].focus();
    type(panels[index]);
    schedule();
  }

  function schedule() {
    clearTimeout(timer);
    if (reduceMotion.matches || root.hasAttribute('data-paused') || !inView) return;
    timer = setTimeout(() => select(index + 1), cycle);
  }

  const pause = () => { root.setAttribute('data-paused', ''); clearTimeout(timer); };
  const resume = () => { root.removeAttribute('data-paused'); select(index); };
  tabs.forEach((tab, i) => tab.addEventListener('click', () => select(i)));
  root.addEventListener('keydown', event => {
    if (!event.target.matches('[role="tab"]')) return;
    if (event.key === 'ArrowRight') select(index + 1, { focus: true });
    if (event.key === 'ArrowLeft') select(index - 1, { focus: true });
  });
  root.addEventListener('pointerenter', pause);
  root.addEventListener('pointerleave', resume);
  root.addEventListener('focusin', pause);
  root.addEventListener('focusout', event => { if (!root.contains(event.relatedTarget)) resume(); });
  new IntersectionObserver(([entry]) => {
    inView = entry.isIntersecting;
    schedule();
  }).observe(root);
  select(0);
}

/* ---------- Mobile buy bar ---------- */
function initBuyBar() {
  const bar = $('#buy-bar');
  const hero = $('.hero');
  const pricing = $('#pricing');
  let pricingVisible = false;
  new IntersectionObserver(([entry]) => {
    pricingVisible = entry.isIntersecting;
    update();
  }, { threshold: 0.05 }).observe(pricing);
  function update() {
    const pastHero = window.scrollY > hero.offsetTop + hero.offsetHeight - 120;
    const show = mobileViewport.matches && pastHero && !pricingVisible;
    bar.hidden = !show;
    document.body.classList.toggle('has-buy-bar', show);
  }
  onScroll(update);
}

/* ---------- Boot ---------- */
initSplit();
initReveal();
initCounters();
initChrome({ bar: $('.scroll-progress'), header });
initConsole($('[data-console]'));
initConsoleTilt($('[data-console]'), $('[data-stage]'));
initSteps($('[data-steps]'));
initScrollSpy($$('.desktop-nav > a, .nav-products > summary'));
initBuyBar();

const horizon = $('[data-horizon]');
if (horizon) initEarth(horizon, { anchor: $('[data-horizon-anchor]'), hero: $('.hero') });

document.documentElement.classList.add('motion-ready');
