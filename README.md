# GetToken

GetToken 静态站点：首页做品牌展示与产品分流，Codex、Claude、Gemini、Grok、住宅 IP 各有一个产品页（三档方案 + 受理状态与询价 + 动态与指南），`/guides/` 是 SEO 文章库。版式参考 resip.net：深色背景、首屏轨道日出动效、渐变描边价格卡。

## 内容

```text
index.html
assets/gettoken/
  home.css          样式（设计变量、各版块、响应式、减少动态效果）
  home.mjs          首页交互：导航、产品演示窗口、移动端选购条
  shop.mjs          首页与产品页共用：服务咨询弹窗、方案摘要、复制、提示条
  chrome.css / chrome.mjs  产品页、审核页、指南页共用的导航栏与页脚样式和交互（与首页同一套，样式规则复制自 home.css，测试保证一致）
  product.mjs       产品页价格卡：切换交付方式与周期、打开咨询弹窗
  product.css       产品页样式（价格卡与首页原定价模块一致）
  motion.mjs        滚动动效：逐字出现、进场、数字递增、步骤连线、导航当前位置高亮
  scenes.mjs        首屏“轨道日出” WebGL 场景（开场升起、星空、夜面地球、大气辉光、日出、流星）
  catalog.mjs       产品、三档、参考报价与交付方式；旧备注码函数不用于订单
  verify.mjs        审核验证页：仅提交 Session Key、私密查询、12 小时处理倒计时与结果
  verify-admin.mjs  审核后台（/verify/admin/）：查看提交、搜索与筛选、复制 Session Key、录入审核结果和说明（保留历史记录处理）
  verify-rules.mjs  审核费用、时长与代码格式（页面、生成脚本与后端共用）
  verify.css        审核页与后台样式
  qr.mjs            二维码生成（把支付平台返回的付款链接画成二维码）
  site.config.mjs   公开客服、主体、时段、时区和逐商品受理配置
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

没有 React、Next.js、node_modules 或第三方字体。首页主体手写，SEO 元信息、导航、页脚与“最新动态”由脚本同步；产品页、指南与审核页面用 Node 原生脚本生成静态 HTML。审核订单由 `server/verify/` 中的 Node.js + SQLite 服务处理。

## 页面结构

全站共用一套导航栏和页脚：产品服务（下拉五个产品）、购买流程、常见问题、审核验证、AI 指南，右侧“联系客服”和随页面变化的主按钮；手机上统一为菜单按钮。首页的导航栏与页脚夹在 `HEADER` / `FOOTER` 标记之间，由 `scripts/build-site.mjs` 生成，不要手改。指南页在导航栏下方另有专题导航。

首页：首屏（地球与太空交界的 WebGL 动效 + 数据条）→ 产品优势 → 五大产品（每张卡链到产品页）与产品演示窗口 → 三步购买流程 → 使用场景 → 最新动态 → 常见问题 → 合规说明 → 页脚。首页不展示价格。

产品页（如 `/claude/`）：卖点与购买保障 → 三档价格卡（蓝 / 紫粉推荐 / 绿，可选意向交付方式与 1/3/12 个月周期，不代表供应已确认）→ 怎么买、怎么验收 → 最新动态与选购指南 → 常见问题 → 其他产品。价格卡在生成时就写进 HTML，不开脚本也能看到价格与说明。

审核页（`/verify/`）用于 Claude KYC 第三方协助，目前仅需填写本人 Session Key 并确认授权，提交成功直接进入人工处理，不需要淘宝订单号或核单。本站支付入口保持隐藏；处理结果不代表 Claude 官方身份认证通过。

[审核后台](https://gettoken.cc/verify/admin/)支持查看提交和录入结果；预计审核时长 12 小时。首次登录与使用方法见[后台操作说明](docs/review-admin.md)。

原浏览器可使用受理编号或最近记录查询，跨设备需保存完整私密查询链接；不要把 Session Key 当作查询口令或放入 URL。后台录入交付摘要或失败原因，不生成费用、付款或退款。历史淘宝与财务记录保留。操作见 [Session Key 提交](docs/session-key-intake.md)。

订单查询使用原浏览器或独立私密查询链接，订单号本身不授予读取权限；浏览器只保存最近五单的查询凭据，不保存 Session Key。历史订单升级先按 [迁移说明](docs/order-access-migration.md) 盘点和私密交付恢复链接，存在未迁移订单会阻止部署切换。后台竞态已在本轮修复，操作绑定当前显示的订单。

## 受理与上线配置

| 内容 | 位置 | 规则 |
| --- | --- | --- |
| 客服渠道、主体、支持时段及时区 | `assets/gettoken/site.config.mjs` | 必须是真实有效渠道；目前渠道和主体为空，时区待确认 |
| 商品可供货档位及期限 | 同文件的 `inquiries` | 逐项核实后启用；仅填数字价格不能开放受理 |
| 商品参考报价 | `assets/gettoken/catalog.mjs` | `monthlyMinor` 使用分/美分；null 显示“待报价”，不代表可付款金额 |
| 商品事实和来源 | `content/product-facts.mjs`、`content/products.mjs` | 记录日期、地区及资格；官方价不是本站售价 |
| 审核服务定义、费用与授权 | `assets/gettoken/verify-rules.mjs` | 服务负责人确认全部规则后再批准，不能只改支付开关 |
| 微信、支付宝商户 | 服务器私有配置 | 真实密钥不进仓库、聊天或日志；见支付交付文档 |

普通商品流程：先看方案受理状态 → 开放时提供咨询摘要 → 支持方核实资格、报价、交付和售后并登记 → 用户决定是否成交。当前五类商品均未受理，没有站内商品支付或持久商品订单。原静态支付配置保留兼容，不作为本轮交易入口。配置或内容修改后必须重新生成 HTML。

详细交接：[询价登记](docs/inquiry-operations.md)、[商品核验](docs/product-facts.md)、[审核开放条件](docs/verify-service-readiness.md)、[支付资料](docs/payment-launch.md)、[本轮验收](docs/iteration-acceptance.md)。

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

纯内容可以静态托管；本项目的正式 canonical、审核 API、查询链接与 Nginx 路由按域名根目录部署，子目录部署需要同步调整这些配置。

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
# 同时验收实际审核发布包、Nginx/TLS、模拟订单、退款和重启恢复：
node scripts/test-verify-api.mjs
```

## 说明

- 动效均为渐进增强：脚本未运行时内容照常显示；系统开启“减少动态效果”时动画会关闭。
- 首屏场景由一个 WebGL 片元着色器实时绘制，以较低分辨率渲染，滚出屏幕或切到后台时暂停；浏览器不支持 WebGL 时显示 CSS 光晕兜底。
- 不携带第三方字体，使用系统字体，字形可能随设备不同。
- GetToken 为独立服务品牌，并非 OpenAI、Anthropic 等第三方的官方平台。
