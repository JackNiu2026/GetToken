# GetToken

<!-- impeccable:product-schema 1 -->

## Platform

web

## Product Purpose

提供 AI 服务的选购信息，以百度与 Google 的自然搜索获取咨询和订单。用户指定五个主题：Codex、Gemini、Grok、Claude、Claude Code；业务以代充和独立账号交付为主。

## Capabilities and Constraints

- 页面为静态 HTML、CSS 和原生 ES modules，无前端框架或第三方构建依赖；审核验证使用独立 Node.js + SQLite 后端处理订单、支付、人工审核和退款。
- 现有首页、导航、文案、样式、住宅 IP 服务和扫码购买交互全部保持 GitHub 最新版本不变。
- SEO 内容集中在 /guides/：指南首页、按产品划分的专题页（承接产品主词）和文章页（承接长尾问题），从 Markdown 生成，可持续扩充；不新增销售页、订单或咨询流程，转化引导到首页套餐区。
- 价格、具体可售套餐、处理时效、联系方式和退款承诺尚未提供，不得编造。
- Claude Code 与 Claude 订阅的关系应按官方说明解释，API 余额不能冒充会员。
- 用户希望 30 天冲刺自然排名前 30，实际排名无法保证。

## Brand Commitments

保留 GetToken 名称、现有 Logo、中文界面和首页深色视觉。首页负责品牌展示与产品分流，不展示价格；价格、交付方式与扫码购买在各产品页，价格卡沿用首页原定价模块的三色样式。指南与产品页继承现有色彩与字体。

## Evidence on Hand

仓库含现有首页、产品目录与测试。暂无可公开使用的客户评价、销售数据、交付截图或商家身份资料；不得伪造。

## Product Principles

- 产品、价格、交付与售后必须可核实。
- 重要内容在 HTML 中直接可读，脚本用于渐进增强。
- 页面满足独立搜索需求，避免关键词复制页面。
- 购买前先确认报价和交付条件。
