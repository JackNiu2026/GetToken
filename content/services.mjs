// Editorial topics, not inventory or guaranteed deliverable plans.
export const SERVICES = Object.freeze([
  {
    "slug": "codex",
    "name": "Codex",
    "intro": "想在自己的账号上开通订阅，或从独立账号开始使用 Codex？先把账号归属、套餐权益与使用额度确认清楚，再决定如何购买。",
    "distinctions": [
      [
        "订阅权益",
        "用 ChatGPT 账号登录 Codex 时，适用权益和用量以该账号当前套餐为准。"
      ],
      [
        "额外使用额度",
        "部分账号可以购买额外使用额度；这与升级订阅不是同一件事。"
      ],
      [
        "API 余额",
        "API Key 的计费路径与订阅不同，购买会员不会自动获得等额 API 余额。"
      ]
    ],
    "guideSlugs": [
      "codex-topup-verification",
      "codex-subscription-credits-api",
      "account-topup-or-independent"
    ],
    "source": [
      "OpenAI Codex 订阅说明",
      "https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan"
    ]
  },
  {
    "slug": "gemini",
    "name": "Gemini",
    "intro": "选择 Gemini 服务，先确认 Google 账号适用的订阅方案，再比较自有账号代充和独立账号交付。套餐名称、地区资格与续费条件同样重要。",
    "distinctions": [
      [
        "产品与套餐",
        "Gemini 是产品入口，付费权益需要对照实际 Google AI 套餐，不应仅凭模型名称判断。"
      ],
      [
        "账号资格",
        "套餐及功能的可用性可能因地区、账号类型和资格不同而变化。"
      ],
      [
        "月付与续费",
        "确认服务期限、到期处理及续费方式，区别正常订阅与限时活动。"
      ]
    ],
    "guideSlugs": [
      "gemini-topup-account-options",
      "gemini-plan-checklist",
      "monthly-subscription-renewal"
    ],
    "source": [
      "Google AI 套餐说明",
      "https://one.google.com/about/google-ai-plans/"
    ]
  },
  {
    "slug": "grok",
    "name": "Grok",
    "intro": "想开通 Grok 或续费 SuperGrok？先确认订阅入口与套餐，再选择给自己的账号代充，或咨询独立账号的交付条件。",
    "distinctions": [
      [
        "订阅入口",
        "把使用入口和会员名称写清楚，避免把不同入口的权益当成相同套餐。"
      ],
      [
        "独立账号",
        "核对账号归属、会员剩余期限及交付后的管理方式。"
      ],
      [
        "API 服务",
        "如果需要程序调用，请单独核实 API 的计费与使用条件，不用会员说明替代。"
      ]
    ],
    "guideSlugs": [
      "grok-subscription-billing-check",
      "grok-subscription-checklist",
      "account-topup-or-independent"
    ],
    "source": [
      "Grok 订阅与账户说明",
      "https://docs.x.ai/grok/faq"
    ]
  },
  {
    "slug": "claude",
    "name": "Claude",
    "intro": "从日常写作到长文档研究，先按使用需求选择 Claude 方案，再确认代充或独立账号的交付方式。把套餐、期限和售后放在同一张清单里比较。",
    "distinctions": [
      [
        "方案与强度",
        "Pro 与 Max 的具体权益和用量应参考当前官方说明及账号实际显示。"
      ],
      [
        "账号归属",
        "代充是协助给已有账号开通订阅；独立账号需要确认账号和会员一并交付的内容。"
      ],
      [
        "编程使用",
        "如果主要使用 Claude Code，应进一步查看编程接入与额度说明。"
      ]
    ],
    "guideSlugs": [
      "claude-topup-verification",
      "claude-pro-max-selection",
      "account-topup-or-independent"
    ],
    "source": [
      "Claude 官方套餐",
      "https://claude.com/pricing"
    ]
  },
  {
    "slug": "claude-code",
    "name": "Claude Code",
    "intro": "Claude Code 的方案选择，首先是接入方式的选择。先分清 Claude 订阅与 API 计费，再核对账号、额度和交付，不把“月卡”当成无限使用承诺。",
    "distinctions": [
      [
        "Claude 订阅",
        "官方说明支持通过适用的 Pro 或 Max 订阅使用 Claude Code，权益以账号实际状态为准。"
      ],
      [
        "API 计费",
        "API 接入与订阅是不同计费路径，需要单独核对凭据、计费和限额。"
      ],
      [
        "第三方月卡",
        "月卡名称不能证明接入官方订阅；购买前必须确认服务提供方、登录方式和额度规则。"
      ]
    ],
    "guideSlugs": [
      "claude-code-cost-checklist",
      "claude-code-subscription-api",
      "claude-code-usage-checklist"
    ],
    "source": [
      "Claude Code 官方接入说明",
      "https://code.claude.com/docs/en/overview"
    ]
  }
].map(Object.freeze));
