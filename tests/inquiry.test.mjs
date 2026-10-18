import test from 'node:test';
import assert from 'node:assert/strict';
import { PRODUCTS, getQuote } from '../assets/gettoken/catalog.mjs';
import { contactReady, inquiryState, inquirySummary } from '../assets/gettoken/inquiry.mjs';

const ready = { contact: { email: 'support@example.test' }, support: { identity: 'Synthetic support', hours: 'Test hours', timeZone: 'UTC' },
  inquiries: { codex: { enabled: true, tiers: ['plus'], periods: [1] } } };

test('unconfigured storefront fails closed for every tier and period', () => {
  for (const [product, value] of Object.entries(PRODUCTS)) for (const tier of Object.keys(value.tiers)) {
    for (const months of [1, 3, 12]) assert.equal(inquiryState(product, tier, months).state, 'unavailable');
  }
});
test('inquiry requires support and explicitly verified supply, not just a price or QR', () => {
  assert.equal(contactReady(ready), true);
  assert.equal(inquiryState('codex', 'plus', 1, ready).state, 'inquiry');
  for (const site of [{}, { ...ready, contact: {} }, { ...ready, support: {} },
    { ...ready, contact: { wechatQr: 'image.png' } }, { ...ready, inquiries: {} }]) {
    assert.equal(inquiryState('codex', 'plus', 1, site).state, 'unavailable');
  }
  for (const [p, t, m] of [['codex', 'plus', 3], ['codex', 'pro5x', 1], ['unknown', 'plus', 1], ['toString', 'plus', 1]]) {
    assert.equal(inquiryState(p, t, m, ready).state, 'unavailable');
  }
});
test('consultation summary preserves selection without implying an order', () => {
  const summary = inquirySummary(getQuote('claude', 'pro', 1, 'topup'));
  assert.match(summary, /Claude · Pro · 代充 · 按月计费/, 'Subscriptions are billed by the month');
  assert.match(summary, /不是订单或成交报价/);
  assert.match(inquirySummary(getQuote('ip', 'standard', 3)), /住宅 IP · 生产线路 · 线路规格待确认 · 意向周期 3 个月/);
});
