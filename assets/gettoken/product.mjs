// The purchase panel on every product page (subscriptions and 住宅 IP).
// Catalog content is rendered at build time; inquiries never create a payment.
import { PRODUCTS, PERIOD_NAMES, getQuote, formatMoney } from './catalog.mjs';
import { $, $$, openPayment } from './shop.mjs';
import { inquiryState } from './inquiry.mjs';

// Choices remain native radio groups (subscriptions have no period group); the summary, the phone bar and the inquiry
// always use the same catalog quote.
for (const root of $$('[data-subscription]')) {
  const product = root.dataset.subscription;
  const catalog = PRODUCTS[product];
  const put = (name, value) => { for (const el of $$(`[data-selection-${name}]`, root)) el.textContent = value; };
  const button = $('[data-inquiry]', root);
  function renderSelection() {
    const quote = getQuote(product,
      $('[data-tier-choice]:checked', root).value,
      Number($('[data-period]:checked', root)?.value ?? 1),
      $('[data-delivery]:checked', root)?.value ?? null);
    const state = inquiryState(product, quote.tier, quote.months);
    // Subscriptions are billed by the month and have no period choice.
    const term = $('[data-period]', root) ? PERIOD_NAMES[quote.months] : '按月';
    const choice = [quote.deliveryName, term].filter(Boolean).join(' · ');
    put('name', `${catalog.name} · ${quote.tierName}`);
    put('delivery', quote.deliveryName);
    put('period', term);
    put('monthly', formatMoney(quote.monthlyMinor, quote.currency));
    put('total', formatMoney(quote.totalMinor, quote.currency));
    put('status', `${quote.name} · ${quote.tierName} · ${choice} · ${state.label}`);
    put('note', state.message);
    $('[data-selection-status]', root).dataset.state = state.state;
    const badge = $('[data-state-badge]', root);
    badge.textContent = state.label;
    badge.dataset.state = state.state;
    $('[data-dock-meta]', root).textContent = `${choice} · ${state.label}`;
    button.textContent = `${state.label} · 查看说明`;
    button.classList.toggle('g-btn--light', state.state === 'inquiry');
    button.classList.toggle('g-btn--ghost', state.state !== 'inquiry');
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
  button.addEventListener('click', event => openPayment(renderSelection(), event.currentTarget));
  renderSelection();

  // Phones stack the summary under the choices: show a bar while the choices are on screen
  // and the summary is not. CSS keeps the bar hidden on wider screens.
  const dock = $('[data-dock]', root);
  const seen = new Map();
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) seen.set(entry.target, entry.isIntersecting);
    dock.hidden = !(seen.get($('[data-choices]', root)) && !seen.get($('#selection', root)));
  });
  observer.observe($('[data-choices]', root));
  observer.observe($('#selection', root));
}
