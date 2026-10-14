import test from 'node:test';
import assert from 'node:assert/strict';
import { PRODUCTS, getQuote, formatMoney, totalLabel, createPaymentReference } from '../assets/gettoken/catalog.mjs';

test('unannounced prices quote as null and render as XX', () => {
  const quote = getQuote('codex', 'pro5x', 3);
  assert.equal(quote.monthlyMinor, null);
  assert.equal(quote.totalMinor, null);
  assert.equal(quote.savingMinor, 0);
  assert.equal(quote.tierName, 'Pro 5x');
  assert.equal(quote.features.length, 3);
  assert.equal(formatMoney(quote.totalMinor, quote.currency), '¥XX');
  assert.equal(totalLabel(quote), '季付 · 3 个月合计 ¥XX');
  assert.equal(formatMoney(null, 'USD'), '$XX');
});

test('every product sells three tiers for every period and delivery', () => {
  assert.deepEqual(Object.keys(PRODUCTS), ['codex', 'claude', 'gemini', 'grok', 'ip']);
  for (const [product, { tiers, deliveries, glyph }] of Object.entries(PRODUCTS)) {
    assert.equal(Object.keys(tiers).length, 3, product);
    assert.ok(glyph, product);
    for (const [key, tier] of Object.entries(tiers)) {
      for (const field of ['name', 'hint', 'badge', 'desc']) assert.ok(tier[field], `${product}.${key}.${field}`);
      assert.equal(tier.features.length, 3, `${product}.${key}`);
      for (const months of [1, 3, 12]) {
        assert.equal(getQuote(product, key, months).months, months);
        for (const delivery of Object.keys(deliveries || {})) assert.equal(getQuote(product, key, months, delivery).delivery, delivery);
      }
    }
  }
  assert.equal(getQuote('claude', 'pro', 1, 'account').deliveryName, '独立账号');
  assert.equal(getQuote('claude', 'pro', 1).deliveryName, null);
});

test('unknown products, tiers and periods are rejected', () => {
  assert.throws(() => getQuote('nope', 'standard', 3), RangeError);
  assert.throws(() => getQuote('ip', 'pro', 3), RangeError);
  assert.throws(() => getQuote('codex', 'plus', 6), RangeError);
  assert.throws(() => getQuote('codex', 'toString', 3), RangeError);
  assert.throws(() => getQuote('ip', 'standard', 3, 'topup'), RangeError, 'IP lines have no account delivery');
  assert.throws(() => getQuote('claude', 'pro', 3, 'toString'), RangeError);
});

test('money formatting trims whole yuan and keeps cents for USD', () => {
  assert.equal(formatMoney(8900, 'CNY'), '¥89');
  assert.equal(formatMoney(8950, 'CNY'), '¥89.50');
  assert.equal(formatMoney(790, 'USD'), '$7.90');
  assert.throws(() => formatMoney(1.5, 'CNY'), RangeError);
  assert.throws(() => formatMoney(100, 'EUR'), RangeError);
  assert.throws(() => formatMoney(undefined, 'CNY'), RangeError);
});

test('payment reference encodes product, period and date', () => {
  const quote = getQuote('claude', 'max5x', 12);
  const ref = createPaymentReference(quote, new Date(2026, 9, 7), () => 0);
  assert.equal(ref, 'GT-CL12-1007-2222');
  assert.match(createPaymentReference(quote), /^GT-CL12-\d{4}-[2-9A-HJKMNP-Z]{4}$/);
  for (const product of Object.keys(PRODUCTS)) assert.match(createPaymentReference(getQuote(product, Object.keys(PRODUCTS[product].tiers)[0], 1)), /^GT-[A-Z]{2}1-/);
});
