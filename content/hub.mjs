// Copy for the /guides/ hub. `updated` changes only when this copy changes; the hub's
// published date is the later of this and the newest article.
export const HUB = Object.freeze({
  updated: '2026-10-13',
  title: 'AI 订阅、充值与代充指南：Codex、Claude、Gemini、Grok - GetToken',
  description: 'GetToken AI 订阅指南：按产品了解 Codex、Claude、Claude Code、Gemini、Grok 的订阅、充值、代充、独立账号与月卡续费，购买前逐项核对。',
  h1: 'AI 订阅、充值与代充指南',
  lead: '按产品整理 Codex、Claude、Claude Code、Gemini 与 Grok 的订阅、充值、代充和续费问题。每篇都写清要核对什么、去哪里核对，并列出官方来源。',
  // Shown as "新手先读" on the hub, in this order.
  startHere: ['account-topup-or-independent', 'monthly-subscription-renewal', 'claude-code-subscription-api'],
  faqs: [
    ['订阅、充值和代充有什么区别？', '订阅是购买会员权益；充值可能指订阅开通、额外用量或 API 余额；代充是协助给已有账号开通或续费的交付方式。先说明产品、使用入口和需求，避免买错服务。'],
    ['月卡是否代表不限量使用？', '月卡描述期限，不代表无限用量。需要同时确认套餐名称、起算时间、额度限制、重置规则、超额处理与续费方式。'],
    ['Claude 和 Claude Code 应该分别购买吗？', 'Claude Code 是编码工具。使用适用的 Claude 订阅与 API 接入是不同计费路径；先核实账号与登录方式，不重复购买相同权益。'],
    ['在哪里查看套餐价格与购买入口？', '在 GetToken 首页的套餐区查看现有方案与购买方式。指南中的产品不表示都已有可售库存；实际套餐、价格、交付和售后以确认为准。'],
  ],
  editorial: [
    '这些指南由 GetToken 根据官方资料和已确认的交付方式整理，帮助核对账号、订阅与购买条件。涉及产品权益、资格和计费的信息会列出来源；具体规则以当前官方说明和目标账号状态为准。',
    '文章日期只在正文或重要信息有实质变化时更新。具体可售套餐、价格、库存、交付时效和售后，以首页公布的渠道确认为准。',
  ],
});
