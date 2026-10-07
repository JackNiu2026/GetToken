import { getQuote, formatMoney } from './catalog.mjs';
import { enhanceSelect, enhanceDropdown } from './choices.mjs';

// All selections are page-local. No requests, persistence or real transactions.
const orderDialog = document.getElementById('order-dialog');
const queryDialog = document.getElementById('query-dialog');
const menuToggle = document.querySelector('.menu-toggle');
const mobileNav = document.getElementById('mobile-nav');
const productNav = document.querySelector('.nav-products');
const header = document.querySelector('.site-header');
const purchaseBar = document.getElementById('mobile-purchase-bar');
const hero = document.querySelector('.hero');
const mobileViewport = window.matchMedia('(max-width: 600px)');
const drawerViewport = window.matchMedia('(max-width: 920px)');
const dialogTriggers = new WeakMap();

function closeMenu() {
  mobileNav.hidden = true;
  menuToggle.setAttribute('aria-expanded', 'false');
  menuToggle.setAttribute('aria-label', '打开菜单');
}

function showDialog(dialog, trigger) {
  closeMenu();
  productNav.open = false;
  dialogTriggers.set(dialog, trigger);
  dialog.showModal();
}

for (const dialog of [orderDialog, queryDialog]) {
  dialog.querySelectorAll('[data-close-dialog]').forEach(button => {
    button.addEventListener('click', () => dialog.close());
  });
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right ||
        event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  });
  dialog.addEventListener('close', () => {
    const trigger = dialogTriggers.get(dialog);
    if (trigger?.getClientRects().length) trigger.focus({ preventScroll: true });
    else if (drawerViewport.matches) menuToggle.focus({ preventScroll: true });
  });
}

document.querySelectorAll('[data-product]').forEach(card => {
  const product = card.dataset.product;
  const tierSelect = card.querySelector('.tier-select');
  const usageSelect = card.querySelector('.usage-select');
  const periodButtons = Array.from(card.querySelectorAll('[data-months]'));
  let months = Number(card.querySelector('[data-months].is-active').dataset.months);

  function renderQuote() {
    const quote = getQuote(product, tierSelect.value, months);
    card.querySelector('.price-value').textContent = formatMoney(quote.monthlyMinor, quote.currency);
    card.querySelector('.price-total').textContent = `${months} 个月合计 ${formatMoney(quote.totalMinor, quote.currency)}`;
    for (const button of periodButtons) {
      const selected = Number(button.dataset.months) === months;
      button.classList.toggle('is-active', selected);
      button.setAttribute('aria-pressed', String(selected));
    }
    return quote;
  }

  tierSelect.addEventListener('change', renderQuote);
  enhanceSelect(tierSelect);
  enhanceDropdown(usageSelect);
  periodButtons.forEach(button => {
    button.addEventListener('click', () => {
      months = Number(button.dataset.months);
      renderQuote();
    });
  });

  const orderButton = card.querySelector('[data-order]');
  orderButton.addEventListener('click', () => {
    const quote = renderQuote();
    const intentLabel = product === 'ip' ? '示例节点' : '使用方向';
    orderDialog.querySelector('[data-dialog-summary]').textContent =
      `${quote.name} · ${quote.tierName}\n${intentLabel}：${usageSelect.value}\n服务周期：${months} 个月\n月度展示价：${formatMoney(quote.monthlyMinor, quote.currency)}\n本次方案合计：${formatMoney(quote.totalMinor, quote.currency)}\n金额单位：${quote.currency === 'CNY' ? '人民币 CNY' : '美元 USD'}`;
    showDialog(orderDialog, orderButton);
  });
  renderQuote();
});

menuToggle.addEventListener('click', () => {
  const open = mobileNav.hidden;
  mobileNav.hidden = !open;
  menuToggle.setAttribute('aria-expanded', String(open));
  menuToggle.setAttribute('aria-label', open ? '关闭菜单' : '打开菜单');
});
mobileNav.querySelectorAll('a').forEach(link => link.addEventListener('click', closeMenu));
document.querySelectorAll('[data-open-query]').forEach(button => {
  button.addEventListener('click', () => showDialog(queryDialog, button));
});
productNav.querySelectorAll('a').forEach(link => {
  link.addEventListener('click', () => { productNav.open = false; });
});
document.addEventListener('click', event => {
  if (!productNav.contains(event.target)) productNav.open = false;
});
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  if (productNav.open) {
    productNav.open = false;
    productNav.querySelector('summary').focus();
  }
  if (!mobileNav.hidden) {
    closeMenu();
    menuToggle.focus();
  }
});

function updateScrollUI() {
  header.classList.toggle('is-scrolled', window.scrollY > 20);
  const showPurchaseBar = mobileViewport.matches && window.scrollY > hero.offsetTop + hero.offsetHeight - 80;
  purchaseBar.hidden = !showPurchaseBar;
  document.body.classList.toggle('has-purchase-bar', showPurchaseBar);
}
window.addEventListener('scroll', updateScrollUI, { passive: true });
window.addEventListener('resize', () => {
  if (!drawerViewport.matches) closeMenu();
  updateScrollUI();
});
updateScrollUI();

// Decorative motion only; information is never hidden until JS runs.
if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches && 'IntersectionObserver' in window) {
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.animate(
        [{ transform: 'translateY(16px)', opacity: .6 }, { transform: 'translateY(0)', opacity: 1 }],
        { duration: 550, easing: 'cubic-bezier(.2,.65,.3,1)', fill: 'none' },
      );
      observer.unobserve(entry.target);
    }
  }, { threshold: .15 });
  document.querySelectorAll('.section-intro, .feature-panel, .steps-list li').forEach(element => observer.observe(element));
}
