// Editorial snapshots, not stock or a sales authorization. Recheck at purchase.
export const PRODUCT_FACTS = Object.freeze({
  codex: { checked: '2026-10-16', source: 'https://help.openai.com/en/articles/9793128-about-chatgpt-pro-tiers',
    note: '官方另有 Pro 500；本页并非完整目录。Pro 100/200 的美元月费仅供参考，新旧账号用量不同；本站未核实供货，不承诺固定倍数。Pro 无官方多月预付。' },
  claude: { checked: '2026-10-16', source: 'https://claude.com/pricing',
    note: '美元月付参考不含适用税费。个人 Pro/Max 与 Team 分开；特定 Max 方案的 API credits 需在 Claude Platform 单独核对，不能视为通用余额或本站交付承诺。' },
  gemini: { checked: '2026-10-16', source: 'https://one.google.com/about/google-ai-plans/',
    note: '官方页面随地区变化，Ultra 还有不同用量版本。未核实目标账号价格，本站不展示固定美元价；功能、存储、家庭资格和续费以本人账号为准。' },
  grok: { checked: '2026-10-16', source: 'https://x.ai/pricing',
    note: '当前公开页列出 Plus/Premium/Super/Ultra。本页 Lite/SuperGrok/Heavy 为历史名称，不作一一对应；原渠道和实际权益核实前暂不受理。' },
  ip: { checked: null, source: null,
    note: '供应规格尚未提供。地区库存、静态/动态、独享含义、协议、带宽流量、并发、验收与故障补偿均须先确认；当前暂不受理。' },
});
