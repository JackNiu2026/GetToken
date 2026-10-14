const PERIODS = Object.freeze([1, 3, 12]);

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

const DELIVERIES = {
  topup: { name: '代充', hint: '充到你的账号' },
  account: { name: '独立账号', hint: '账号 + 会员' },
};

// Prices are in minor units (fen / cent). `null` means "not announced yet" and
// renders as an XX placeholder everywhere; set an integer to publish a price,
// then run `node scripts/build-site.mjs` so the product pages show it without JavaScript.
// `periodRate` is the multiplier applied per period; 1 means no discount.
// Set e.g. `{ 3: 0.95, 12: 0.85 }` to show savings on longer periods.
// Tiers render in order on the product page; the first, second and third card use the
// blue, violet (featured) and green pricing styles. `ref` is the official list price
// shown only for comparison; GetToken's own price is `monthlyMinor`.
export const PRODUCTS = deepFreeze({
  codex: {
    name: 'Codex',
    glyph: '>_',
    currency: 'CNY',
    periodRate: { 1: 1, 3: 1, 12: 1 },
    deliveries: DELIVERIES,
    tiers: {
      plus: {
        name: 'Plus', hint: '日常开发', badge: '入门首选',
        desc: '个人开发、学习与原型搭建，每天几轮 Codex 任务就够用。',
        features: ['含 Codex', '终端 / IDE / 网页', '可随时升级'],
        ref: '$20/月', monthlyMinor: null,
      },
      pro5x: {
        name: 'Pro 5x', hint: '高强度', badge: '开发主力',
        desc: '每天连续用 Codex 写代码、跑检查，用量约为 Plus 的 5 倍。',
        features: ['约 5 倍 Plus 用量', '适合连续开发', '多项目切换'],
        ref: '$100/月', monthlyMinor: null,
      },
      pro20x: {
        name: 'Pro 20x', hint: '重度并行', badge: '团队 / 重度',
        desc: '多个项目并行、长时间代理任务，适合团队或重度用户，用量约为 Plus 的 20 倍。',
        features: ['约 20 倍 Plus 用量', '多任务并行', '用量最宽裕'],
        ref: '$200/月', monthlyMinor: null,
      },
    },
  },
  claude: {
    name: 'Claude',
    glyph: '✦',
    currency: 'CNY',
    periodRate: { 1: 1, 3: 1, 12: 1 },
    deliveries: DELIVERIES,
    tiers: {
      pro: {
        name: 'Pro', hint: '日常使用', badge: '入门首选',
        desc: '适合日常写作、研究阅读与轻量编程，每天几轮对话就够用。',
        features: ['含 Claude Code', '多端可用', '可随时升级'],
        ref: '$20/月', monthlyMinor: null,
      },
      max5x: {
        name: 'Max 5x', hint: '高强度', badge: '编程主力',
        desc: '每天连续用 Claude Code 写代码、处理长文档，用量约为 Pro 的 5 倍。',
        features: ['约 5 倍 Pro 用量', '适合连续编程', '新功能优先'],
        ref: '$100/月', monthlyMinor: null,
      },
      max20x: {
        name: 'Max 20x', hint: '重度并行', badge: '团队 / 重度',
        desc: '多个项目并行、长时间代理任务，适合团队或重度用户，用量约为 Pro 的 20 倍。',
        features: ['约 20 倍 Pro 用量', '多任务并行', '用量最宽裕'],
        ref: '$200/月', monthlyMinor: null,
      },
    },
  },
  gemini: {
    name: 'Gemini',
    glyph: '◆',
    currency: 'CNY',
    periodRate: { 1: 1, 3: 1, 12: 1 },
    deliveries: DELIVERIES,
    tiers: {
      plus: {
        name: 'AI Plus', hint: '轻量使用', badge: '入门首选',
        desc: '日常问答、写作与资料整理，先用较低的价格体验 Gemini 高级功能。',
        features: ['Gemini 高级模型', '云端存储', '可随时升级'],
        ref: '约 $7.99/月', monthlyMinor: null,
      },
      pro: {
        name: 'AI Pro', hint: '日常主力', badge: '最多人选',
        desc: '查资料、写长文与多模态创作，包含 Deep Research 与更大的云端存储。',
        features: ['Deep Research', '多模态创作', '更大云端存储'],
        ref: '$19.99/月', monthlyMinor: null,
      },
      ultra: {
        name: 'AI Ultra', hint: '重度创作', badge: '专业 / 重度',
        desc: '面向开发者与专业创作者，开放最高用量与最新的实验功能。',
        features: ['最高用量', '实验功能优先', '适合专业创作'],
        ref: '$99.99/月起', monthlyMinor: null,
      },
    },
  },
  grok: {
    name: 'Grok',
    glyph: 'G',
    currency: 'CNY',
    periodRate: { 1: 1, 3: 1, 12: 1 },
    deliveries: DELIVERIES,
    tiers: {
      lite: {
        name: 'SuperGrok Lite', hint: '轻量使用', badge: '入门首选',
        desc: '追热点、查实时信息与日常问答，先用轻量档位体验 SuperGrok。',
        features: ['实时信息', '日常问答', '可随时升级'],
        ref: '约 $10/月', monthlyMinor: null,
      },
      supergrok: {
        name: 'SuperGrok', hint: '日常主力', badge: '最多人选',
        desc: '长对话、调研与创作的主力档位，用量和功能更完整。',
        features: ['更高用量', '长对话调研', '图像创作'],
        ref: '$30/月', monthlyMinor: null,
      },
      heavy: {
        name: 'SuperGrok Heavy', hint: '重度使用', badge: '专业 / 重度',
        desc: '需要最强模型与最高用量的重度用户，适合复杂推理与长时间任务。',
        features: ['最强模型', '最高用量', '复杂推理'],
        ref: '$300/月', monthlyMinor: null,
      },
    },
  },
  ip: {
    name: '住宅 IP',
    glyph: '◎',
    currency: 'USD',
    periodRate: { 1: 1, 3: 1, 12: 1 },
    tiers: {
      starter: {
        name: '入门线路', hint: '单一环境', badge: '先试试',
        desc: '一个店铺或一个账号先用起来，所需地区在付款后与客服确认。',
        features: ['独立住宅 IP', '单一环境', '可随时升级'],
        ref: null, monthlyMinor: null,
      },
      standard: {
        name: '生产线路', hint: '日常使用', badge: '跨境必备',
        desc: '跨境电商、AI 工具和多环境运营，店铺与账号各有独立环境。',
        features: ['按场景选择线路', '适合多环境隔离', '协议与方案可扩展'],
        ref: null, monthlyMinor: null,
      },
      premium: {
        name: '旗舰线路', hint: '高要求场景', badge: '长期稳定',
        desc: '长期运营的店铺与账号，对稳定性要求更高的场景。',
        features: ['更高稳定性', '适合长期店铺', '优先售后响应'],
        ref: null, monthlyMinor: null,
      },
    },
  },
});

export const PERIOD_OPTIONS = PERIODS;
export const PERIOD_NAMES = Object.freeze({ 1: '月付', 3: '季付', 12: '年付' });

export function getQuote(productKey, tierKey, months, deliveryKey = null) {
  const product = Object.hasOwn(PRODUCTS, productKey) ? PRODUCTS[productKey] : null;
  const tier = product && Object.hasOwn(product.tiers, tierKey) ? product.tiers[tierKey] : null;
  if (!product || !tier) throw new RangeError('Unknown product or tier');
  if (!PERIODS.includes(months)) throw new RangeError('Unsupported period');
  const deliveries = product.deliveries || {};
  if (deliveryKey !== null && !Object.hasOwn(deliveries, deliveryKey)) throw new RangeError('Unknown delivery');
  const delivery = deliveryKey === null ? null : deliveries[deliveryKey];
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
    delivery: deliveryKey,
    deliveryName: delivery ? delivery.name : null,
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

// "季付 · 3 个月合计 ¥XX", shared by the generated page and the live card.
export function totalLabel(quote) {
  return `${PERIOD_NAMES[quote.months]} · ${quote.months} 个月合计 ${formatMoney(quote.totalMinor, quote.currency)}`;
}

const PRODUCT_CODES = Object.freeze({ codex: 'CX', claude: 'CL', gemini: 'GM', grok: 'GK', ip: 'IP' });
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
