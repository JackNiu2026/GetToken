// Product pages (/codex/, /claude/ …): live price cards and the payment dialog.
// The cards are rendered at build time, so prices and copy read fine without JavaScript.
import { getQuote, formatMoney, totalLabel } from './catalog.mjs';
import { $, $$, openPayment } from './shop.mjs';
import { inquiryState } from './inquiry.mjs';

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

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
