# SEO 验收记录

检查日期：2026-10-09。范围：保留原首页，新增独立导航与十三篇文章；百度与 Google 使用同一内容。

## 完成的代码与内容

- 原首页等七个既有文件保持 GitHub `0fe017b` 基线字节一致。
- 十四个新增 HTML 页面，连同首页共十五个 sitemap URL；32 个关键词对应规范页面或导航主题。
- 新页有独立元数据、HTTPS canonical、面包屑与对应内容的结构化数据。
- 十三篇文章各含整理方、实际修改日期、两个 FAQ、三个相关阅读，以及适用的官方来源；没有新增销售表单或虚构价格。
- 正文和链接无需 JavaScript；修改日期不随构建刷新；原首页没有虚构修改日期。
- Nginx 提供 gzip、真实 404 和新增 URL 别名 301，保留查询参数，避免目录内部索引造成重定向循环。
- 检查、打包和 CI 覆盖内容同步、原首页保持不变、抓取规则与发布包实际 HTTP 行为。

## 验证证据

| 项目 | 结果与限制 |
| --- | --- |
| Node 测试 | 17 项，覆盖原首页基线、内容、规范 URL、打包、robots 规则与线上检查器错误识别 |
| 实际 Nginx 发布包 | 292 项 HTTP 检查、gzip 与查询参数保留；仅为本地服务器验收 |
| 浏览器 | 桌面与手机检查导航及三篇代表文章；360/390px 下全部十三篇文章禁用 JavaScript 后可读，无横向溢出；原有付款交互、FAQ、目录与相关阅读通过 |
| 布局稳定性 | 本地无网络或 CPU 限速的八个样本 CLS 为 0；不作为线上 Core Web Vitals 或真实用户速度结论 |
| 生产请求 | incomplete：环境出站策略阻断 CONNECT；未获取真实站点响应 |
| 收录／排名／搜索量 | 未测量，跟进表保留空值 |

原始结果在 `.impeccable/review/seo/`，不随网站部署。截图在 `.impeccable/review/`，最终标题样式复核另存 `final-wrap-check.json`。重复执行命令与维护规则见 `SEO.md`。

## 上线前仍需完成

1. 配置正式域名与 HTTPS，确认 CDN／WAF 允许真实 Googlebot 和 Baiduspider 获取内容，再运行生产检查。
2. 核实可售产品、套餐、真实总价、期限、交付与咨询入口。确认后的服务信息才能支撑购买决策和交易型搜索意图。
3. 验证 Google Search Console 与百度搜索资源平台，提交 sitemap 与 URL，查看抓取及收录报告。
4. 若以后允许首页增添普通导航入口，可改善站内发现；本轮首页完全不变。
5. 用真实曝光和排名决定后续内容，而非生成同义关键词页。首月跟进应从实际发布日起算。

## 官方资料复核

以下计费、入口和用量规则可能更新，维护时须重新确认。

- [Google SEO 入门](https://developers.google.com/search/docs/fundamentals/seo-starter-guide)、[sitemap 与 lastmod](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)、[Article 标记](https://developers.google.com/search/docs/appearance/structured-data/article)：内容可读、链接可发现、元数据真实；标记与提交不保证收录或排名。
- [百度链接提交](https://ziyuan.baidu.com/linksubmit)：按已验证账号提供的入口提交；提交不保证收录。
- [Codex 套餐](https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan)、[额外用量 credits](https://help.openai.com/en/articles/12642688-using-credits-for-flexible-usage-in-chatgpt-personal-plans)：分清订阅、用量与 API，核对实际身份。
- [Google AI Pro](https://support.google.com/googleone/answer/16476811?hl=zh-Hans)：账号资格与家庭权益按实际方案确认。
- [Grok 账户与账单](https://docs.x.ai/grok/faq)：按原购买入口和账号关联核对，避免重复订阅。
- [Claude Code 订阅与 API](https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan)：核对 ANTHROPIC_API_KEY 等实际身份及计费来源。
- [Claude 账单](https://support.claude.com/en/articles/8325618-paid-plan-billing-faqs)、[额外用量](https://support.claude.com/en/articles/12429409-manage-usage-credits-for-paid-claude-plans)、[Max／Team API credits](https://support.claude.com/en/articles/17154008-monthly-api-credits-for-max-and-team-plans)：不宣称会员包含所有 API 使用，也不宣称任何方案都没有独立 API 权益。

公开搜索结果仅用于了解用户措辞和问题类型，没有取得可靠月搜索量、竞争难度或竞争站流量。本轮达到受保留页面范围与真实资料约束的可验收状态，不能宣称已进入前三页或绝对最优。
