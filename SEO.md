# GetToken AI 订阅指南（SEO 内容库）

首页 `index.html` 及其资源保持不变。所有 SEO 内容集中在 `/guides/` 下，由 `scripts/build-site.mjs` 从 Markdown 生成静态 HTML。不依赖 npm，线上没有运行时 JavaScript。

## 网址结构

| 网址 | 页面 | 作用 |
| --- | --- | --- |
| `/guides/` | 指南首页 | 新手先读、按产品浏览、最近更新、常见问题、内容原则 |
| `/guides/{专题}/` | 专题页 | 承接产品主词（如“Claude 代充”）：专题介绍、三条要点、该专题全部文章 |
| `/guides/{专题}/page/{n}/` | 专题分页 | 每页 20 篇，超过时自动生成 |
| `/guides/{文章}/` | 文章页 | 承接具体长尾问题 |
| `/guides/feed.xml` | RSS | 最新 50 篇 |
| `/navigation/` | 已下线 | Nginx 301 到 `/guides/`，保留查询参数 |

文章网址与旧版相同，已收录的链接不会失效。专题与文章同在 `/guides/` 下，构建时会拒绝与专题同名、或使用 `page`、`feed` 等保留词的文章名。

## 新增一篇文章

在 `content/guides/` 新建 `文章网址.md`，文件名即网址，只用小写字母、数字和连字符：

```markdown
---
title: Claude Max 续费前要核对什么？
description: 搜索结果里显示的摘要，80–120 字，写清问题和答案方向。
summary: 页面顶部的导语和列表摘要，一两句话直接回答问题。
topic: claude
topics: [claude-code]
updated: 2026-10-20
published: 2026-10-20
related:
  - claude-topup-verification
  - monthly-subscription-renewal
---
## 第一个小标题

正文段落。一行一段，空行分段。可以用 **加粗**、`代码`、[站内链接](/guides/claude/) 和 [外部链接](https://claude.com/pricing)。

- 列表项
- 列表项

| 项目 | 说明 |
| --- | --- |
| 第一列会作为行标题 | 其余列为内容 |

> 以 > 开头的段落显示为提示框。

## 常见问题

### 问题写成三级标题？

答案写成下面的段落。

## 资料来源

- [官方来源名称](https://example.com/official)
```

字段说明：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `title` | 是 | H1 与标题标签；全站唯一 |
| `description` | 是 | meta description；全站唯一 |
| `summary` | 是 | 导语、列表摘要、RSS 摘要 |
| `topic` | 是 | 主专题，决定面包屑和配色 |
| `topics` | 否 | 同时出现在哪些其他专题 |
| `updated` | 是 | 正文实质修改的日期；构建不会自动改 |
| `published` | 否 | 首次上线日期；不知道就不填，不要编造 |
| `related` | 否 | 相关阅读；不足 3 篇时自动补同专题最新文章 |

至少两个正文 `##` 小节。`## 常见问题` 与 `## 资料来源` 是固定标题，会被单独渲染；资料来源必须是 HTTPS 链接。格式写错时构建会报出文件名和原因。

写完后：

```bash
node scripts/build-site.mjs      # 生成页面、专题列表、sitemap 与 RSS
node --test tests/*.test.mjs     # 检查标题重复、断链、结构化数据、首页不变等
```

把 `content/guides/*.md` 和生成的 `guides/`、`sitemap.xml` 一起提交。

## 新增一个专题

在 `content/topics.mjs` 加一项：`slug`（网址）、`name`、`title`、`description`、`short`（指南首页卡片说明）、`intro`、三条 `facts`、可选的官方 `source`、`mark`（装饰字符）、`tone`（`blue`、`violet`、`orange`、`cyan`、`silver`、`green`）和 `updated`。至少要有一篇文章属于它。页头导航、页脚和指南首页会自动出现新专题。

指南首页文案、“新手先读”和常见问题在 `content/hub.mjs`。

## 每页的 SEO 处理

- 独立的 title、description、H1、HTTPS canonical、Open Graph；中文 `lang`。
- 页面上可见的面包屑，与 BreadcrumbList 结构化数据一致。
- 结构化数据：Organization、WebSite；指南首页与专题页为 CollectionPage + ItemList；文章为 Article（作者、发布方、更新日期、引用来源）。不编造价格、库存、评价、Offer 或 FAQ 富结果。
- 内链：指南首页 → 专题 → 文章；文章 → 专题、相关阅读；页头和页脚列出全部专题。每篇文章最多三次点击可达。
- 内容直接写在 HTML 里，百度和 Google 看到的内容与用户一致；目录、FAQ 使用原生链接和 `details`。
- sitemap 包含全部规范网址与真实更新日期；robots 允许全部抓取；RSS 帮助发现新文章。
- 页面只加载 `assets/guides/guides.css`（约 20KB，gzip 后约 5KB），不加载首页的样式和脚本。
- 每篇文章底部、侧栏和专题页都引导到首页套餐区（`/#pricing`）。

## 写作原则

- 一个搜索意图只写一篇。相近关键词合并到同一篇，不批量生成换词页面。
- 标题直接回答问题；`summary` 第一句就给结论。
- 涉及权益、资格、计费的内容附官方来源，并写清“以账号实际显示为准”。
- 不写未确认的价格、库存、时效或售后承诺。
- 只在内容实质变化时更新 `updated`。

## 发布与检查

```bash
node scripts/build-site.mjs --check
node --test tests/*.test.mjs
python3 -m unittest discover -s tests -p 'test_*.py'
node scripts/seo-report.mjs
node scripts/package-site.mjs /tmp/gettoken-site.tar.gz
node scripts/test-nginx.mjs      # Linux + Docker：真实 Nginx 验证发布包与跳转
```

合并到 `main` 后 GitHub Actions 自动部署，并执行 `node scripts/check-live-seo.mjs --revision <提交>` 检查正式域名：全部规范页 200、正文与构建一致、canonical、日期、结构化数据、robots、sitemap、RSS、404、`index.html` 与无斜线别名，以及 `/navigation/` 301 到 `/guides/`。

`node scripts/seo-report.mjs` 输出到 `.impeccable/review/seo/`：`submit-urls.txt`（全部正式网址）、`ranking-tracker.csv`（百度与 Google 各 32 个查询，排名与流量留空待测）和 `content-report.json`。`content/keywords.mjs` 维护关键词与目标页的对应关系；产品主词指向专题页。

## 收录与运营

1. 在 Google Search Console 与百度搜索资源平台验证域名，提交 `https://gettoken.cc/sitemap.xml`。
2. 第 7 天检查抓取与收录；排查 robots、重定向、CDN 拦截。
3. 第 14 天起按平台、地区、设备记录曝光；有曝光但点击少时，优化与正文一致的标题和摘要。
4. 按 `ranking-tracker.csv` 里排在 10–30 名的查询补充对应文章，而不是新开重复页面。
5. 首页目前没有指向 `/guides/` 的入口（按要求保持首页不变）。以后如果允许，在首页加一个普通链接能明显加快收录。

排名受竞争、网站信誉和抓取影响，无法保证。私密 token 不放进代码，也不用 Google Indexing API 提交普通文章。
