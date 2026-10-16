---
title: Codex 充值怎么选？订阅、使用额度与 API 余额区别
description: 分清 Codex 订阅、额外使用额度与 API 余额，按登录方式核对购买内容，避免把会员代充当成 API 充值。
summary: 用 ChatGPT 账号登录 Codex 时，先核对订阅与使用额度；用 API 凭据时，查看对应计费账户。会员、额外用量与 API 余额不能仅凭“充值”两个字混买。
topic: codex
updated: 2026-10-16
related:
  - codex-topup-verification
  - account-topup-or-independent
  - monthly-subscription-renewal
verified: 2026-10-16
---
## 先找正在使用的登录身份

用 ChatGPT 账号登录 Codex 时，先查看该账号方案与 Codex 用量；API 凭据接入则查看开发者或实际提供方的计费账户。一个入口的余额不代表另一个入口也有余额。

1. 在 ChatGPT 的当前方案入口确认订阅；Pro 用户注意 Pro 100/200/500 及新旧资格差异，不按旧 5x/20x 名称推断额度。
2. 在 Codex 的 Settings、Usage & Billing 或官方用量面板确认耗尽的是哪一项额度、余额和重置时间；CLI 当前支持时可用 `/status`。
3. 若是 API 身份，转到对应计费账户确认项目、预算与余额，不向普通客服发送 API Key。

## 三类费用的具体区别

| 费用 | 解决什么需求 | 付款前检查 |
| --- | --- | --- |
| 订阅 | 适用方案的权益和包含用量 | 实际方案、账号资格、周期 |
| 额外 credits | 补充符合条件的功能用量 | 账号是否提供入口、适用功能、使用条件 |
| API 账单 | 程序通过 API 使用服务 | 实际组织/项目、模型价格、预算 |

官方当前说明部分功能可能共享额度池；credits 不支持所有功能，也不是 API 通用余额。实际范围以目标账号及当前官方说明为准。

## 三个不该直接重复购买的例子

- 只是当前窗口耗尽且能等到重置：先等待或调整任务，不一定需要新会员。
- 购买后在另一账号登录：先改回正确身份，不用再给错误账号购买。
- API 预算不足：先核对 API 账单；再买 ChatGPT 会员不会自动补足 API 预算。

这些是假设排障场景。免费方案也可能有有限 Codex 权益；是否需要付费应由实际需求和账号状态决定。

## 询价和期限

普通询价只说明登录类型、当前方案、任务需求和意向周期。ChatGPT Pro 官方按月计费，本站多月选项只表达需求，须另约逐月履约与失败处理。个人访问的共享及转售限制也必须核实，不能把独立账号名称当作官方许可。

## 常见问题

### Codex 充值就是购买 ChatGPT 会员吗？

不一定。可能指订阅、额外使用额度或 API 余额；先核对登录方式和实际需要，再确定服务内容。

### 开通 Codex 订阅会自动获得等额 API 余额吗？

不能这样推断。订阅权益和 API 计费需要分别核对；额外使用额度也不是通用 API 余额。

## 资料来源

- [Codex 与 ChatGPT 套餐](https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan)
- [额外使用额度说明](https://help.openai.com/en/articles/12642688-using-credits-for-flexible-usage-in-chatgpt-personal-plans)

- [Pro 名称、资格与周期](https://help.openai.com/en/articles/9793128-about-chatgpt-pro-tiers)
