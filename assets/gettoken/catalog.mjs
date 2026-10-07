const PERIODS = Object.freeze([1, 3, 12]);

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

// Prices are in minor units (fen / cent). `null` means "not announced yet" and
// renders as an XX placeholder everywhere; set an integer to publish a price.
// `periodRate` is the multiplier applied per period; 1 means no discount.
// Set e.g. `{ 3: 0.95, 12: 0.85 }` to show savings on longer periods.
export const PRODUCTS = deepFreeze({
  codex: {
    name: 'Codex',
    currency: 'CNY',
    periodRate: { 1: 1, 3: 1, 12: 1 },
    tiers: {
      starter: {
        name: '体验版',
        hint: '个人尝鲜',
        features: ['独立账号方案', '适合轻量编码与学习', '先用起来，再决定'],
        monthlyMinor: null,
      },
      standard: {
        name: '标准版',
        hint: '日常主力',
        features: ['独立账号方案', '适合连续开发工作流', '清晰的升级路径'],
        monthlyMinor: null,
      },
      flagship: {
        name: '旗舰版',
        hint: '团队 / 重度',
        features: ['适合高频与多项目并行', '团队协作取向', '优先售后响应'],
        monthlyMinor: null,
      },
    },
  },
  claude: {
    name: 'Claude',
    currency: 'CNY',
    periodRate: { 1: 1, 3: 1, 12: 1 },
    tiers: {
      starter: {
        name: '体验版',
        hint: '个人尝鲜',
        features: ['长文本工作取向', '适合写作与日常问答', '先用起来，再决定'],
        monthlyMinor: null,
      },
      standard: {
        name: '标准版',
        hint: '日常主力',
        features: ['长文本工作取向', '适合研究与创作', '按阶段选择强度'],
        monthlyMinor: null,
      },
      flagship: {
        name: '旗舰版',
        hint: '团队 / 重度',
        features: ['适合长文档与大项目', '团队协作取向', '优先售后响应'],
        monthlyMinor: null,
      },
    },
  },
  ip: {
    name: '住宅 IP',
    currency: 'USD',
    periodRate: { 1: 1, 3: 1, 12: 1 },
    tiers: {
      standard: {
        name: '生产线路',
        hint: '日常使用',
        features: ['按场景选择线路', '适合多环境隔离', '协议与方案可扩展'],
        monthlyMinor: null,
      },
      premium: {
        name: '旗舰线路',
        hint: '高要求场景',
        features: ['更高要求的稳定场景', '适合长期店铺与账号', '优先售后响应'],
        monthlyMinor: null,
      },
    },
  },
});

export const PERIOD_OPTIONS = PERIODS;

export function getQuote(productKey, tierKey, months) {
  const product = Object.hasOwn(PRODUCTS, productKey) ? PRODUCTS[productKey] : null;
  const tier = product && Object.hasOwn(product.tiers, tierKey) ? product.tiers[tierKey] : null;
  if (!product || !tier) throw new RangeError('Unknown product or tier');
  if (!PERIODS.includes(months)) throw new RangeError('Unsupported period');
  const priced = Number.isInteger(tier.monthlyMinor);
  const rate = product.periodRate?.[months] ?? 1;
  const effectiveMonthlyMinor = priced ? Math.round(tier.monthlyMinor * rate) : null;
  const totalMinor = priced ? effectiveMonthlyMinor * months : null;
  const savingMinor = priced ? tier.monthlyMinor * months - totalMinor : 0;
  return {
    product: productKey,
    name: product.name,
    tier: tierKey,
    tierName: tier.name,
    tierHint: tier.hint,
    features: tier.features,
    currency: product.currency,
    months,
    monthlyMinor: effectiveMonthlyMinor,
    listMonthlyMinor: tier.monthlyMinor,
    totalMinor,
    savingMinor,
  };
}

export function formatMoney(minor, currency) {
  if (!['CNY', 'USD'].includes(currency)) throw new RangeError('Invalid currency');
  if (minor === null) return `${currency === 'CNY' ? '¥' : '$'}XX`;
  if (!Number.isInteger(minor)) throw new RangeError('Invalid money value');
  const amount = (minor / 100).toFixed(2);
  const trimmed = currency === 'USD' ? amount : amount.replace(/\.00$/, '');
  return `${currency === 'CNY' ? '¥' : '$'}${trimmed}`;
}

const PRODUCT_CODES = Object.freeze({ codex: 'CX', claude: 'CL', ip: 'IP' });
const REF_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

// Human-friendly payment remark so a manual check can match a transfer to a plan.
// Not an order id: nothing is stored or sent anywhere.
export function createPaymentReference(quote, date = new Date(), random = Math.random) {
  const code = PRODUCT_CODES[quote.product];
  if (!code) throw new RangeError('Unknown product');
  const stamp = `${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
  let suffix = '';
  for (let i = 0; i < 4; i += 1) suffix += REF_ALPHABET[Math.floor(random() * REF_ALPHABET.length)];
  return `GT-${code}${quote.months}-${stamp}-${suffix}`;
}
