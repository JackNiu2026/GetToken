// Copy for the /guides/ hub. `updated` changes only when this copy changes; the hub's
// published date is the later of this and the newest article.
export const HUB = Object.freeze({
  updated: '2026-10-16',
  title: 'AI 订阅、充值与代充指南：Codex、Claude、Gemini、Grok - GetToken',
  description: 'GetToken AI 订阅指南：按产品了解 Codex、Claude、Claude Code、Gemini、Grok 的订阅、充值、代充、独立账号与月卡续费，购买前逐项核对。',
  h1: 'AI 订阅、充值与代充指南',
  lead: '选套餐先读选择与资格指南；查额度先核对登录和计费；购买后按验收、续费和账单排障文章逐步处理。按下面专题找到对应产品，先看答案再决定是否需要购买。',
  // Shown as "新手先读" on the hub, in this order.
  startHere: ['account-topup-or-independent', 'monthly-subscription-renewal', 'claude-code-subscription-api'],
  faqs: [
    ['订阅、充值和代充有什么区别？', '订阅是购买会员权益；充值可能指订阅开通、额外用量或 API 余额；代充是协助给已有账号开通或续费的交付方式。先说明产品、使用入口和需求，避免买错服务。'],
    ['月卡是否代表不限量使用？', '月卡描述期限，不代表无限用量。需要同时确认套餐名称、起算时间、额度限制、重置规则、超额处理与续费方式。'],
    ['Claude 和 Claude Code 应该分别购买吗？', 'Claude Code 是编码工具。使用适用的 Claude 订阅与 API 接入是不同计费路径；先核实账号与登录方式，不重复购买相同权益。'],
    ['在哪里查看套餐价格与购买入口？', '从对应商品页查看方案与受理状态。显示“暂未受理”时请勿付款；开放询价后先确认资格、总价、交付与售后，官方参考价不代表本站售价。'],
  ],
  editorial: [
    '指南优先引用能支持结论的官方资料，区分公开文档核验、实际账号操作和假设示例；未使用你的账号实测的路径会说明边界。商品供应仍需另行确认，文章不代表库存或交付承诺。',
    '正文或重要事实实质改变才更新日期，核验日期不冒充首发日。发现过时入口时修正源内容并说明边界；套餐、价格和供货同步核对商品页及事实记录。受理状态不明确时不引导付款。',
  ],
});
