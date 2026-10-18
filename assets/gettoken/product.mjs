// Subscription configurators and the legacy residential IP cards.
// Catalog content is rendered at build time; inquiries never create a payment.
import { PRODUCTS, PERIOD_NAMES, getQuote, formatMoney, totalLabel } from './catalog.mjs';
import { $, $$, openPayment } from './shop.mjs';
import { inquiryState } from './inquiry.mjs';

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

// One shared configurator per subscription page. Choices remain native radio
// groups; the summary and inquiry always use the same catalog quote.
for (const root of $$('[data-subscription]')) {
  const product = root.dataset.subscription;
  const catalog = PRODUCTS[product];
  const put = (name, value) => { $(`[data-selection-${name}]`, root).textContent = value; };
  function renderSelection() {
    const quote = getQuote(product,
      $('[data-tier-choice]:checked', root).value,
      Number($('[data-period]:checked', root).value),
      $('[data-delivery]:checked', root).value);
    const state = inquiryState(product, quote.tier, quote.months);
    put('name', `${catalog.name} · ${quote.tierName}`);
    put('desc', catalog.tiers[quote.tier].desc);
    put('delivery', quote.deliveryName);
    put('period', PERIOD_NAMES[quote.months]);
    put('monthly', formatMoney(quote.monthlyMinor, quote.currency));
    put('total', formatMoney(quote.totalMinor, quote.currency));
    put('status', `${quote.name} · ${quote.tierName} · ${quote.deliveryName} · ${PERIOD_NAMES[quote.months]} · ${state.label}`);
    put('note', state.message);
    $('[data-inquiry]', root).textContent = `${state.label} · 查看说明`;
    $('[data-selection-features]', root).replaceChildren(...quote.features.map(feature => {
      const li = document.createElement('li');
      li.textContent = feature;
      return li;
    }));
    return quote;
  }
  root.addEventListener('change', event => {
    if (event.target.matches('input[type="radio"]')) renderSelection();
  });
  $('[data-inquiry]', root).addEventListener('click', event => openPayment(renderSelection(), event.currentTarget));
  renderSelection();
}

function animateValue(el, from, to, currency) {
  if (reduceMotion.matches || from === to || from === null || to === null) {
    el.textContent = formatMoney(to, currency);
    return;
  }
  const step = currency === 'CNY' ? 100 : 1;
  const start = performance.now();
  const tick = now => {
    const p = Math.min(1, (now - start) / 520);
    const eased = 1 - Math.pow(1 - p, 3);
    const value = Math.round((from + (to - from) * eased) / step) * step;
    el.textContent = formatMoney(p === 1 ? to : value, currency);
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

for (const card of $$('[data-plan]')) {
  const { product, tier } = card.dataset;
  const priceEl = $('[data-price]', card);
  const totalEl = $('[data-total]', card);
  let shownMonthly;

  const read = () => getQuote(
    product,
    tier,
    Number($('input[data-period]:checked', card).value),
    $('input[data-delivery]:checked', card)?.value ?? null,
  );

  function render() {
    const quote = read();
    animateValue(priceEl, shownMonthly === undefined ? quote.monthlyMinor : shownMonthly, quote.monthlyMinor, quote.currency);
    shownMonthly = quote.monthlyMinor;
    totalEl.textContent = totalLabel(quote);
    $('[data-buy]', card).textContent = inquiryState(product, tier, quote.months).label;
    if (quote.savingMinor > 0) {
      const saving = document.createElement('b');
      saving.textContent = ` 省 ${formatMoney(quote.savingMinor, quote.currency)}`;
      totalEl.append(saving);
    }
    return quote;
  }

  card.addEventListener('change', event => { if (event.target.matches('input[type="radio"]')) render(); });
  $('[data-buy]', card).addEventListener('click', event => openPayment(render(), event.currentTarget));
  render();
}
