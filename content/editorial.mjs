// Dates are edited only when substantive content changes, never at build time.
export const EDITORIAL = Object.freeze({
  navigationModified: '2026-10-09',
  organization: 'GetToken',
});
export const GUIDE_DETAILS = {
  'codex-subscription-credits-api': {
    title: 'Codex 充值怎么选？订阅、使用额度与 API 余额区别',
    summary: '用 ChatGPT 账号登录 Codex 时，先核对订阅与使用额度；用 API 凭据时，查看对应计费账户。会员、额外用量与 API 余额不能仅凭“充值”两个字混买。',
    related: ['codex-topup-verification', 'account-topup-or-independent', 'monthly-subscription-renewal'],
    faqs: [['Codex 充值就是购买 ChatGPT 会员吗？', '不一定。可能指订阅、额外使用额度或 API 余额；先核对登录方式和实际需要，再确定服务内容。'], ['开通 Codex 订阅会自动获得等额 API 余额吗？', '不能这样推断。订阅权益和 API 计费需要分别核对；额外使用额度也不是通用 API 余额。']],
  },
  'gemini-plan-checklist': {
    title: 'Gemini 订阅代充怎么选？Google AI 套餐与账号资格',
    summary: 'Gemini 会员选购要对照实际 Google AI 套餐、目标账号资格和所需功能。先检查原订阅与地区条件，再比较代充或独立账号，活动价不能替代续费总价。',
    related: ['gemini-topup-account-options', 'account-topup-or-independent', 'monthly-subscription-renewal'],
    faqs: [['Google AI Pro 代充适合所有账号吗？', '不能保证。应先核对个人账号资格、地区、现有订阅和原购买渠道，以账号中的实际可用方案为准。'], ['Gemini 独立账号是否包含付费会员？', '必须在报价中写明。账号交付、会员套餐、有效期和管理权限需要分别确认。']],
  },
  'grok-subscription-checklist': {
    title: 'Grok / SuperGrok 订阅代充与月卡：购买、续费核对',
    related: ['grok-subscription-billing-check', 'account-topup-or-independent', 'monthly-subscription-renewal'],
    faqs: [['SuperGrok 月卡是不是无限使用？', '不是。服务期限与用量是不同维度，需核对实际套餐、额度、重置规则和额外收费。'], ['Grok 独立账号交付后查什么？', '核对实际账号、是否含会员、到期时间、管理权限，以及后续续费与售后条件。']],
  },
  'claude-pro-max-selection': {
    title: 'Claude Pro / Max 订阅怎么选？代充与独立账号核对',
    related: ['claude-topup-verification', 'claude-code-subscription-api', 'claude-code-cost-checklist'],
    faqs: [['Claude Pro 和 Max 应该只比较价格吗？', '还要比较任务强度、实际用量、接入方式、周期与售后。更高价格不保证更适合每个人。'], ['Claude 月卡一定能用于 Claude Code 吗？', '要核实实际订阅、账号和登录方式。“月卡”是商家期限标签，不能代替官方权益说明。']],
  },
  'claude-code-subscription-api': {
    title: 'Claude Code 充值怎么选？Claude 订阅与 API 计费区别',
    summary: 'Claude Code 可以按适用订阅或 API 路径使用，实际费用取决于登录与凭据配置。先核对当前计费身份，再购买代充、账号或额度，避免重复支付同一权益。',
    related: ['claude-code-cost-checklist', 'claude-code-usage-checklist', 'claude-pro-max-selection'],
    faqs: [['Claude Code 需要另外买一份同名官方会员吗？', '不能仅凭工具名称判断。使用适用 Claude 订阅时，先确认该账号支持的权益；API 路径则按对应计费规则核对。'], ['订阅、API 和额外用量能混用余额吗？', '不能直接互相替代。部分套餐可能附带独立 API 额度，需分别核对适用范围、余额和计费主体。']],
  },
  'claude-code-usage-checklist': {
    related: ['claude-code-cost-checklist', 'claude-code-subscription-api', 'monthly-subscription-renewal'],
    faqs: [['Claude Code 月卡还有期限为什么仍被限额？', '有效期与用量限制是不同条件。先查看实际用量、重置提示和预算，再判断是否需要续费或补充额度。'], ['Claude Code 达到额度后一定要再充值吗？', '不一定。可能可以等待重置，也可能涉及不同计费路径或环境配置；先查明限制来源。']],
  },
  'account-topup-or-independent': {
    services: ['codex', 'gemini', 'grok', 'claude', 'claude-code'],
    related: ['monthly-subscription-renewal', 'gemini-topup-account-options', 'codex-topup-verification'],
    faqs: [['AI 代充与独立账号哪个更适合我？', '希望保留原账号时可先咨询代充；需要单独账号时可比较独立交付。两者都要核对会员、权限、周期和售后。'], ['独立账号交付是否等于完整账号所有权？', '不能仅凭名称推断。应明确账号归属、可管理信息、会员内容及约定的权限范围。']],
  },
  'monthly-subscription-renewal': {
    services: ['codex', 'gemini', 'grok', 'claude', 'claude-code'],
    related: ['account-topup-or-independent', 'grok-subscription-billing-check', 'claude-topup-verification'],
    faqs: [['AI 月卡一定有完整一个月吗？', '需要确认是交付后起算还是已有订阅的剩余期限，并写清到期时间。'], ['取消续费就一定会退款吗？', '不一定。取消自动续费与退款是不同操作，应核对原购买渠道和实际退款条件。']],
  },
};
