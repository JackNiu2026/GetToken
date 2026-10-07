import test from 'node:test';
import assert from 'node:assert/strict';
import { PRODUCTS, getQuote, formatMoney, createPaymentReference } from '../assets/gettoken/catalog.mjs';

test('unannounced prices quote as null and render as XX', () => {
  const quote = getQuote('codex', 'standard', 3);
  assert.equal(quote.monthlyMinor, null);
  assert.equal(quote.totalMinor, null);
  assert.equal(quote.savingMinor, 0);
  assert.equal(quote.tierName, '标准版');
  assert.equal(quote.features.length, 3);
  assert.equal(formatMoney(quote.totalMinor, quote.currency), '¥XX');
  assert.equal(formatMoney(null, 'USD'), '$XX');
});

test('every tier quotes for every period', () => {
  for (const [product, { tiers }] of Object.entries(PRODUCTS)) {
    for (const tier of Object.keys(tiers)) {
      for (const months of [1, 3, 12]) assert.equal(getQuote(product, tier, months).months, months);
    }
  }
});

test('unknown products, tiers and periods are rejected', () => {
  assert.throws(() => getQuote('nope', 'standard', 3), RangeError);
  assert.throws(() => getQuote('ip', 'starter', 3), RangeError);
  assert.throws(() => getQuote('codex', 'standard', 6), RangeError);
  assert.throws(() => getQuote('codex', 'toString', 3), RangeError);
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
  const quote = getQuote('claude', 'standard', 12);
  const ref = createPaymentReference(quote, new Date(2026, 9, 7), () => 0);
  assert.equal(ref, 'GT-CL12-1007-2222');
  assert.match(createPaymentReference(quote), /^GT-CL12-\d{4}-[2-9A-HJKMNP-Z]{4}$/);
});
