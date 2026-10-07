const PERIODS = Object.freeze([1, 3, 12]);

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export const PRODUCTS = deepFreeze({
  codex: {
    name: 'Codex',
    currency: 'CNY',
    accent: 'blue',
    tiers: {
      starter: { name: '体验版', monthlyMinor: 3900 },
      standard: { name: '标准版', monthlyMinor: 8900 },
      flagship: { name: '旗舰版', monthlyMinor: 19900 },
    },
  },
  claude: {
    name: 'Claude',
    currency: 'CNY',
    accent: 'violet',
    tiers: {
      starter: { name: '体验版', monthlyMinor: 4900 },
      standard: { name: '标准版', monthlyMinor: 10900 },
      flagship: { name: '旗舰版', monthlyMinor: 23900 },
    },
  },
  ip: {
    name: '住宅 IP',
    currency: 'USD',
    accent: 'mint',
    tiers: {
      standard: { name: '生产线路', monthlyMinor: 790 },
      premium: { name: '旗舰线路', monthlyMinor: 1290 },
    },
  },
});

export function getQuote(productKey, tierKey, months) {
  const product = Object.hasOwn(PRODUCTS, productKey) ? PRODUCTS[productKey] : null;
  const tier = product && Object.hasOwn(product.tiers, tierKey) ? product.tiers[tierKey] : null;
  if (!product || !tier) throw new RangeError('Unknown product or tier');
  if (!PERIODS.includes(months)) throw new RangeError('Unsupported period');
  return {
    product: productKey,
    name: product.name,
    tier: tierKey,
    tierName: tier.name,
    currency: product.currency,
    months,
    monthlyMinor: tier.monthlyMinor,
    totalMinor: tier.monthlyMinor * months,
  };
}

export function formatMoney(minor, currency) {
  if (!Number.isInteger(minor) || !['CNY', 'USD'].includes(currency)) {
    throw new RangeError('Invalid money value');
  }
  const amount = (minor / 100).toFixed(2);
  const trimmed = currency === 'USD' ? amount : amount.replace(/\.00$/, '');
  return `${currency === 'CNY' ? '¥' : '$'}${trimmed}`;
}

export const PERIOD_OPTIONS = PERIODS;
