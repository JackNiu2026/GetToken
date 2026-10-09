# 独立 SEO 导航与内容维护

原首页及既有 UI 保持 GitHub 基线（`origin/main`，`0fe017b`）不变。新增 `/navigation/` 与十三篇专题文章，承接 Codex、Gemini、Grok、Claude、Claude Code 的订阅、充值、代充、独立账号、月卡与续费需求。本站已知主要交付方式是代充、独立账号；说明性文章不代表库存或报价承诺。

## 页面与搜索意图

| 内容组 | 解决的问题 |
| --- | --- |
| `/navigation/` 与五个品牌主题 | 辨认产品、交付方式与阅读入口；主题锚点不是五个独立排名页面 |
| Codex 两篇 | 订阅、额外用量与 API 的区别；代充后账号与订阅验收 |
| Gemini 两篇 | Google AI 套餐资格；原账号代充、独立账号与家庭权益的区别 |
| Grok 两篇 | 开通套餐核对；网页、X 与应用商店的登录和账单来源 |
| Claude 两篇 | Pro / Max 选择；会员、账单与续费验收 |
| Claude Code 三篇 | 订阅和 API 接入；用量排查；同一周期的实际总成本 |
| 通用两篇 | 代充与独立账号交付；月卡期限与续费 |

`content/keywords.mjs` 将 32 个主词和长尾词映射到这些内容。映射来自公开搜索结果用语、官方资料和已确认的交付方式，**没有测得搜索量、关键词难度或真实排名**。相同意图集中在一个页面，避免复制正文生成大量后缀词页面。文章均有具体核对步骤、可见 FAQ、三个相关阅读链接和内容整理方及修改日期。

## 编辑与生成

```bash
node scripts/build-site.mjs
node scripts/build-site.mjs --check
node --test tests/*.test.mjs
node scripts/seo-report.mjs
node scripts/package-site.mjs /tmp/gettoken-site.tar.gz
# Linux + Docker + curl：验证实际发布包和 Nginx 模板
node scripts/test-nginx.mjs
```

生成与检查使用 Node 原生模块，无需 npm install。线上为静态 HTML，没有新增运行时 JavaScript 或 Node 服务。CI 检查生成结果、原首页基线、内容及爬取规则，再用真实 Nginx 验证打包后的网站。

| 内容 | 编辑源 |
| --- | --- |
| 品牌主题、导航与文章关联 | `content/services.mjs` |
| 八篇原专题正文 | `content/guides.mjs` |
| 五篇代充、账号与成本专题 | `content/topup-guides.mjs` |
| 原专题 FAQ、相关阅读、编辑规则与修改日期 | `content/editorial.mjs` |
| 关键词与目标页面 | `content/keywords.mjs` |
| 正式域名 | `content/site.mjs` |
| 模板、元数据、结构化数据、robots、sitemap | `scripts/build-site.mjs` |
| 新页面样式 | `assets/gettoken/pages.css` |

修改内容后才更新对应的 `modified` 日期；导航实质修改后再更新 `navigationModified`。构建不会自动刷新日期，也不会给原首页添加虚构 lastmod。草稿不伪造线上首次发布日期。来源链接须直接支持正文，并随产品变化复核。

生成器不读写原首页。基线测试校验原首页、样式、交互、动效、目录与配置的字节一致性。发布包仅包含首页、站点资源、新导航、十三篇文章、robots 和 sitemap；报告、编辑源与设计记录不进入发布包。

## 百度与 Google 的共同技术基础

新增内容直接出现在 HTML 中，包括标题、目录、表格、FAQ、来源和普通链接；两家爬虫与用户读取相同内容。每页有独立 title、description、H1、正式 HTTPS canonical、社交分享元数据和面包屑。结构化数据包括 Organization、WebSite、CollectionPage、ItemList、BreadcrumbList、Article，与可见作者、正文和日期对应。不编造价格、库存、评价、授权、交付保障或 Offer 数据，不承诺 FAQ 富结果。

robots 允许 Googlebot 与 Baiduspider，指向含首页及十四个新增页面的 sitemap。部署模板为新增页的 `index.html` 和无末尾斜线地址提供保留查询参数的相对 301；不存在的规范路径返回 404；开启 gzip。HTTPS、DNS、CDN 与实际服务器配置仍须在生产域名验证。

## 发布验收与提交

默认域名来自原站 canonical：`https://gettoken.cc`。实际域名不同，需要统一原站与 SEO 配置后重新生成。安装脚本仍提供 HTTP 80；正式 HTTPS 需要真实证书及域名入口配置，见 `DEPLOYMENT.md`。

在能访问正式域名的环境执行：

```bash
node scripts/check-live-seo.mjs --output /tmp/gettoken-live-seo.json
```

检查全部规范页的 HTTP/MIME/title/description/canonical、noindex、作者日期、结构化数据、相关阅读、Googlebot 与 Baiduspider robots 规则、sitemap、资源、404、别名及 HTTP→HTTPS。传输失败报告 incomplete，不把代理阻断当成网站错误。即使通过，也不代表已经收录、有排名或达到真实用户 Core Web Vitals。

`node scripts/seo-report.mjs` 输出本地 `.impeccable/review/seo/`：

- `submit-urls.txt`：15 个正式 URL，用于检查与平台提交。
- `ranking-tracker.csv`：百度与 Google 各 32 个查询；日期、地区、设备、排名、曝光、点击、咨询及成交留空，等待测量。
- `content-report.json`：页面体积和关键词目标，明确标记生产未验证。

验证 Google Search Console 与百度搜索资源平台后提交 sitemap，并使用账号实际提供的 URL 提交入口。私密 token 不放入代码，也不用 Google Indexing API 提交普通文章。[Google sitemap 说明](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)；[百度链接提交](https://ziyuan.baidu.com/linksubmit)。

按用户要求，原首页没有新增导航入口。新页依靠 sitemap、平台提交及真实外部链接发现；文章彼此互链并链接回首页。如以后允许首页加一个普通入口，可加强站内发现。本轮不安排虚构外链、批量灌水或未经授权的推广。

## 首月执行与判断

| 时间 | 操作与判断 |
| --- | --- |
| 第 1–3 天 | 发布，验证 HTTPS 与爬取响应；验证两家站长账号；提交 sitemap 与重要 URL；确认实际套餐、价格和咨询入口 |
| 第 7 天 | 检查抓取与收录；排查 robots、noindex、重定向、CDN 拦截及 URL 发现问题 |
| 第 14 天 | 按平台、地区、设备记录真实曝光；有曝光但点击弱时，改善与正文一致的标题和摘要 |
| 第 21 天 | 优先补充接近前 30 位且符合真实服务的页面，加入确认后的报价、交付细节或问题答案 |
| 第 30 天 | 比较收录、排名、点击、咨询与成交；依据数据调整，避免发布重复文章 |

品牌主词与购买长尾分别记录。排名受竞争、网站信誉、实际服务信息和搜索平台抓取影响，30 天进入前三页不能保证。代码验收后，下一轮有效优化需要真实数据，不应继续堆关键词。

## 本轮验收与限制

见 `SEO-AUDIT.md`。上述本地验收阶段尚未推送或发布到生产；后续发布结果以 GitHub Actions 和实际站点检查为准。托管环境的出站白名单不包含 `gettoken.cc`，生产请求在代理 CONNECT 阶段被拒绝；这不能证明网站返回 403。本地验收没有已验证的搜索平台账号、生产部署凭据或真实报价资料，发布包通过不能替代这些条件。
