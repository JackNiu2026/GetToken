# GetToken

GetToken 静态站点：首页做品牌展示与产品分流，Codex、Claude、Gemini、Grok、住宅 IP 各有一个产品页（三档价格 + 扫码购买 + 动态与指南），`/guides/` 是 SEO 文章库。版式参考 resip.net：深色背景、首屏轨道日出动效、渐变描边价格卡。

## 内容

```text
index.html
assets/gettoken/
  home.css          样式（设计变量、各版块、响应式、减少动态效果）
  home.mjs          首页交互：导航、产品演示窗口、移动端选购条
  shop.mjs          首页与产品页共用：客服弹窗、扫码付款弹窗、复制、提示条
  chrome.css / chrome.mjs  产品页、审核页、指南页共用的导航栏与页脚样式和交互（与首页同一套，样式规则复制自 home.css，测试保证一致）
  product.mjs       产品页价格卡：切换交付方式与周期、打开付款弹窗
  product.css       产品页样式（价格卡与首页原定价模块一致）
  motion.mjs        滚动动效：逐字出现、进场、数字递增、步骤连线、导航当前位置高亮
  scenes.mjs        首屏“轨道日出” WebGL 场景（开场升起、星空、夜面地球、大气辉光、日出、流星）
  catalog.mjs       产品、三档、价格、交付方式与付款备注码
  verify.mjs        审核验证页：提交代码、在线付款二维码、审核倒计时、结果、最新通过跑马灯
  verify-admin.mjs  审核后台（/verify/admin/）：订单列表、查看代码、录入通过 / 未通过、退款
  verify-rules.mjs  审核费用、时长与代码格式（页面、生成脚本与后端共用）
  verify.css        审核页与后台样式
  qr.mjs            二维码生成（把支付平台返回的付款链接画成二维码）
  site.config.mjs   收款码、客服微信二维码与联系方式
  logo.png
  favicon.svg
content/
  products.mjs      产品页文案（卖点、常见问题、官方价来源）
  guides/*.md       文章：指南或动态（一篇一个 Markdown 文件）
  topics.mjs        指南专题
  hub.mjs           指南首页文案
assets/guides/guides.css   指南与产品页的基础样式（首页不加载）
codex/ claude/ gemini/ grok/ ip/   产品页，由 scripts/build-site.mjs 生成，不要手改
verify/             审核验证页与后台页，由 scripts/build-site.mjs 生成，不要手改
server/verify/      审核验证后端（Node.js + SQLite）：订单、支付宝 / 微信支付、退款、后台接口
guides/             由 scripts/build-site.mjs 生成，不要手改
scripts/            生成、打包、部署与线上检查脚本
tests/
```

没有 React、Next.js、node_modules 或第三方字体。首页手写，只有“最新动态”一块由脚本填入；产品页和指南用 Node 原生脚本生成静态 HTML。

## 页面结构

全站共用一套导航栏和页脚：产品服务（下拉五个产品）、购买流程、常见问题、审核验证、AI 指南，右侧“联系客服”和随页面变化的主按钮；手机上统一为菜单按钮。首页的导航栏与页脚夹在 `HEADER` / `FOOTER` 标记之间，由 `scripts/build-site.mjs` 生成，不要手改。指南页在导航栏下方另有专题导航。

首页：首屏（地球与太空交界的 WebGL 动效 + 数据条）→ 产品优势 → 五大产品（每张卡链到产品页）与产品演示窗口 → 三步购买流程 → 使用场景 → 最新动态 → 常见问题 → 合规说明 → 页脚。首页不展示价格。

产品页（如 `/claude/`）：卖点与购买保障 → 三档价格卡（蓝 / 紫粉推荐 / 绿，可选交付方式与月付、季付、年付）→ 怎么买、怎么验收 → 最新动态与选购指南 → 常见问题 → 其他产品。价格卡在生成时就写进 HTML，不开脚本也能看到价格与说明。

审核验证页（`/verify/`，导航栏“审核验证”）：填写以 sk 开头的代码 → 确认费用（人工技术费 ¥30 不退，审核费 ¥300 未通过时 24 小时内退回）→ 支付宝或微信在线付款 → 到账后进入审核，页面显示 24 小时倒计时 → 审核员在后台录入结果，页面显示“恭喜，审核通过”或“很遗憾，没有通过”及退款进度。倒计时只表示预计时间，结果只来自后台录入。右侧“最新通过”只展示真实通过且本人同意展示的订单，代码打码为末 4 位，满 5 条才滚动。用户可凭订单号在任何设备查询，本机也会记住最近的订单。费用和时长在 `assets/gettoken/verify-rules.mjs`，改完执行 `node scripts/build-site.mjs`。在线支付开通前，`open: false` 让导航栏和审核页显示“即将开放”；接入支付宝 / 微信并验收后改为 `true` 再生成页面。后端部署、支付商户配置和后台密码见 [DEPLOYMENT.md](DEPLOYMENT.md#审核验证服务verify-与-apiverify)。

## 上线前需要配置

| 内容 | 位置 | 说明 |
|---|---|---|
| 收款码 | `assets/gettoken/site.config.mjs` → `payment.methods[].qr` | 把图片放到 `assets/gettoken/pay/`，填相对网站根目录的路径，如 `./assets/gettoken/pay/wechat.png`。留空时显示“收款码待上传”占位。`currencies` 决定该方式出现在人民币还是美元方案里。 |
| 客服微信二维码 | `site.config.mjs` → `contact.wechatQr` | 所有“微信咨询”“订单查询”按钮打开的客服窗口都会显示这张图，路径写法同收款码。 |
| 客服联系方式 | `site.config.mjs` → `contact` | 微信号、Telegram、邮箱；留空的项不显示，全部为空且没有二维码时显示“客服联系方式即将公布”。 |
| 价格 | `assets/gettoken/catalog.mjs` → `monthlyMinor` | 当前为 `null`，页面显示 `¥XX` / `$XX`。填整数（单位为分/美分，如 `8900` = ¥89）即上线价格。**改完要执行 `node scripts/build-site.mjs`**，产品页的静态价格才会更新。 |
| 周期折扣 | `catalog.mjs` → `periodRate` | 默认全部为 `1`（无折扣）。如 `{ 1: 1, 3: 0.95, 12: 0.85 }` 会自动显示“省 ¥X”。 |
| 档位文案与官方参考价 | `catalog.mjs` → `tiers` | 每个产品固定三档，顺序即卡片顺序，第二档为推荐。`ref` 是官方月付价，只用于对照，来源写在 `content/products.mjs` 的 `source`。 |

付款流程：用户在产品页选档位、交付方式和周期，点“扫码购买”→ 弹窗显示订单摘要（含交付方式）、付款备注码与收款码 → 用户付款并备注 → 把截图发给客服 → 人工核对后交付。页面不发送任何请求，也不保存任何数据。

## 本地预览

产品页在 `/codex/`、`/claude/`、`/gemini/`、`/grok/`、`/ip/`；SEO 内容在 `/guides/`：指南首页、按产品划分的专题页和文章页，旧的 `/navigation/` 301 到 `/guides/`。写动态、新增文章与专题、收录步骤见 [SEO.md](SEO.md)。修改 `content/` 或 `catalog.mjs` 后执行：

```bash
node scripts/build-site.mjs
node scripts/build-site.mjs --check
```

云服务器和 GitHub Actions 自动部署见 [DEPLOYMENT.md](DEPLOYMENT.md)。

```bash
python -m http.server 8899 --bind 127.0.0.1
```

浏览器访问首页 `http://127.0.0.1:8899/`、产品页 `http://127.0.0.1:8899/claude/` 或指南 `http://127.0.0.1:8899/guides/`。ES modules 需要通过 HTTP 加载，不要直接双击 HTML 文件。

也可以直接放到任意静态托管服务；所有资源使用相对路径，兼容子目录部署。

审核验证页需要同源的 `/api/verify/`。本地只开静态服务时，页面会显示“审核服务暂时无法连接”。要在本地走完整流程，先启动测试模式后端，再用任意能把 `/api/verify/` 转发到 `127.0.0.1:8790` 的本地服务器（如 Nginx，规则同 `scripts/nginx-seo-locations.conf`）打开页面：

```bash
export VERIFY_SECRET=$(openssl rand -hex 32) VERIFY_PAY_MODE=mock VERIFY_DATA_DIR=/tmp/gettoken-verify
node server/verify/cli.mjs passwd      # 设置本地后台密码
node server/verify/server.mjs          # 监听 127.0.0.1:8790
```

## 测试

```bash
node --test tests/*.test.mjs
node scripts/seo-report.mjs
# Linux + Docker 环境可验证真实 Nginx 发布包：
node scripts/test-nginx.mjs
```

## 说明

- 动效均为渐进增强：脚本未运行时内容照常显示；系统开启“减少动态效果”时动画会关闭。
- 首屏场景由一个 WebGL 片元着色器实时绘制，以较低分辨率渲染，滚出屏幕或切到后台时暂停；浏览器不支持 WebGL 时显示 CSS 光晕兜底。
- 不携带第三方字体，使用系统字体，字形可能随设备不同。
- GetToken 为独立服务品牌，并非 OpenAI、Anthropic 等第三方的官方平台。
