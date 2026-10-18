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
// renders as 待报价 everywhere; set an integer to publish a reference quote,
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
        ref: '$20/月', monthlyMinor: 14000,
      },
      pro5x: {
        name: 'Pro 100', hint: '高强度', badge: '开发主力',
        desc: '用于较频繁的个人开发。具体模型、用量与账号资格以当前官方方案为准。',
        features: ['个人 Pro 方案', '用量依账号规则', '不含团队席位'],
        ref: '$100/月', monthlyMinor: 69000,
      },
      pro20x: {
        name: 'Pro 200', hint: '重度并行', badge: '个人 / 重度',
        desc: '适合需要更多个人用量的用户；新旧订阅的额度可能不同，不保证旧版倍数。',
        features: ['个人 Pro 方案', '需核对新旧资格', '不是最高官方档位'],
        ref: '$200/月', monthlyMinor: 115000,
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
        ref: '$20/月', monthlyMinor: 17000,
      },
      max5x: {
        name: 'Max 5x', hint: '高强度', badge: '编程主力',
        desc: '每天连续用 Claude Code 写代码、处理长文档，用量约为 Pro 的 5 倍。',
        features: ['约 5 倍 Pro 用量', '适合连续编程', '新功能优先'],
        ref: '$100/月', monthlyMinor: 95000,
      },
      max20x: {
        name: 'Max 20x', hint: '重度并行', badge: '个人 / 重度',
        desc: '面向高强度个人任务，按官方 Max 20x 规则计算用量；不包含团队席位或管理权限。',
        features: ['官方用量规则', '个人重度任务', '不是团队席位'],
        ref: '$200/月', monthlyMinor: 195000,
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
        ref: null, monthlyMinor: null,
      },
      pro: {
        name: 'AI Pro', hint: '日常主力', badge: '日常使用',
        desc: '查资料、写长文与多模态创作，包含 Deep Research 与更大的云端存储。',
        features: ['Deep Research', '多模态创作', '更大云端存储'],
        ref: null, monthlyMinor: null,
      },
      ultra: {
        name: 'AI Ultra', hint: '重度创作', badge: '专业 / 重度',
        desc: '面向较高强度的创作需求；Ultra 存在不同用量版本，需按账号地区核对。',
        features: ['核对 Ultra 版本', '功能依地区资格', '存储依实际方案'],
        ref: null, monthlyMinor: null,
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
        name: 'Lite（旧名称）', hint: '轻量使用', badge: '入门首选',
        desc: '原轻量方案名称仅供识别旧记录；当前入口与对应权益需重新核实，暂不受理。',
        features: ['实时信息', '日常问答', '可随时升级'],
        ref: null, monthlyMinor: null,
      },
      supergrok: {
        name: 'SuperGrok（旧名称）', hint: '日常主力', badge: '日常使用',
        desc: '此为原方案名称，不代表当前官方完整目录或本站可供货范围，暂不受理。',
        features: ['更高用量', '长对话调研', '图像创作'],
        ref: null, monthlyMinor: null,
      },
      heavy: {
        name: 'Heavy（旧名称）', hint: '重度使用', badge: '专业 / 重度',
        desc: '原 Heavy 方案需按实际账号及购买渠道核实，不再承诺旧价格或最高用量。',
        features: ['旧方案待核实', '按原渠道核对', '当前暂不受理'],
        ref: null, monthlyMinor: null,
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
        desc: '单一环境的需求分类；报价前确认地区库存、协议、带宽和流量，暂不承诺具体线路。',
        features: ['地区库存待确认', '协议规格待确认', '单一环境需求'],
        ref: null, monthlyMinor: null,
      },
      standard: {
        name: '生产线路', hint: '日常使用', badge: '跨境必备',
        desc: '多环境需求需逐项确认并发数、独享含义、带宽与流量；供应规格未核实前不受理。',
        features: ['按场景选择线路', '适合多环境隔离', '协议与方案可扩展'],
        ref: null, monthlyMinor: null,
      },
      premium: {
        name: '旗舰线路', hint: '高要求场景', badge: '长期需求',
        desc: '长期使用需确认测试窗口、故障处理、替换与补偿规则；名称不代表可用性保证。',
        features: ['验收方式待确认', '故障规则待确认', '供应核实后受理'],
        ref: null, monthlyMinor: null,
      },
    },
  },
});

export const PERIOD_OPTIONS = PERIODS;
export const PERIOD_NAMES = Object.freeze({ 1: '1 个月', 3: '3 个月', 12: '12 个月' });

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
  if (minor === null) return '待报价';
  if (!Number.isInteger(minor)) throw new RangeError('Invalid money value');
  const amount = (minor / 100).toFixed(2);
  const trimmed = currency === 'USD' ? amount : amount.replace(/\.00$/, '');
  return `${currency === 'CNY' ? '¥' : '$'}${trimmed}`;
}

// "季付 · 3 个月合计 ¥XX", shared by the generated page and the live card.
export function totalLabel(quote) {
  if (quote.totalMinor === null) return `意向周期 ${quote.months} 个月 · 资格与履约待确认`;
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
