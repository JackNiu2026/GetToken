# GetToken

GetToken 首页的独立静态版本：Codex、Claude 与住宅 IP 三款产品的展示与扫码购买入口。版式参考 resip.net：深色背景、首屏轨道日出动效、渐变描边价格卡。

## 内容

```text
index.html
assets/gettoken/
  home.css          样式（设计变量、各版块、响应式、减少动态效果）
  home.mjs          页面交互：价格卡、预设方案、扫码付款弹窗、导航、移动端购买条
  motion.mjs        滚动动效：逐字出现、进场、数字递增、步骤连线、导航当前位置高亮
  scenes.mjs        首屏“轨道日出” WebGL 场景（开场升起、星空、夜面地球、大气辉光、日出、流星）
  catalog.mjs       产品、档位、价格与付款备注码
  site.config.mjs   收款码与客服联系方式
  logo.png
  favicon.svg
tests/
  catalog.test.mjs
```

没有 React、Next.js、node_modules、第三方字体或构建步骤。

## 页面结构

首屏（地球与太空交界的 WebGL 动效 + 数据条）→ 产品优势 → 三大产品与产品演示窗口 → 三步购买流程 → 价格 → 三档方案对比 → 使用场景 → 常见问题 → 合规说明 → 页脚。

“方案对比”和“使用场景”里的按钮会一键预填价格卡（产品、档位、周期），然后滚动到对应卡片。

## 上线前需要配置

| 内容 | 位置 | 说明 |
|---|---|---|
| 收款码 | `assets/gettoken/site.config.mjs` → `payment.methods[].qr` | 把图片放到 `assets/gettoken/pay/`，填相对路径，如 `./assets/gettoken/pay/wechat.png`。留空时显示“收款码待上传”占位。`currencies` 决定该方式出现在人民币还是美元方案里。 |
| 客服联系方式 | `site.config.mjs` → `contact` | 微信、Telegram、邮箱；留空的项不显示，全部为空时显示“客服联系方式即将公布”。 |
| 价格 | `assets/gettoken/catalog.mjs` → `monthlyMinor` | 当前为 `null`，页面显示 `¥XX` / `$XX`。填整数（单位为分/美分，如 `8900` = ¥89）即上线价格。 |
| 周期折扣 | `catalog.mjs` → `periodRate` | 默认全部为 `1`（无折扣）。如 `{ 1: 1, 3: 0.95, 12: 0.85 }` 会自动显示“省 ¥X”。 |

付款流程：用户点“扫码购买”→ 弹窗显示订单摘要、付款备注码与收款码 → 用户付款并备注 → 把截图发给客服 → 人工核对后交付。页面不发送任何请求，也不保存任何数据。

## 本地预览

云服务器和 GitHub Actions 自动部署见 [DEPLOYMENT.md](DEPLOYMENT.md)。

```bash
python -m http.server 8899 --bind 127.0.0.1
```

浏览器访问 `http://127.0.0.1:8899/`。ES modules 需要通过 HTTP 加载，不要直接双击 HTML 文件。

也可以直接放到任意静态托管服务；所有资源使用相对路径，兼容子目录部署。

## 测试

```bash
node --test tests/*.test.mjs
```

## 说明

- 动效均为渐进增强：脚本未运行时内容照常显示；系统开启“减少动态效果”时动画会关闭。
- 首屏场景由一个 WebGL 片元着色器实时绘制，以较低分辨率渲染，滚出屏幕或切到后台时暂停；浏览器不支持 WebGL 时显示 CSS 光晕兜底。
- 不携带第三方字体，使用系统字体，字形可能随设备不同。
- GetToken 为独立服务品牌，并非 OpenAI、Anthropic 等第三方的官方平台。
