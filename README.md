# gettoken

当前 gettoken 首页的精简、独立静态版本：Codex、Claude 与住宅 IP 三个方案窗口。

## 内容

```text
index.html
assets/gettoken/
  home.css
  home.mjs
  catalog.mjs
  choices.mjs
  logo.png
  favicon.svg
```

只包含页面自身的 HTML、CSS、JavaScript 和品牌图片。没有 React、Next.js、node_modules、第三方字体、安装依赖、缓存、截图、备份、抓取工具或服务器二进制。

## 本地预览

安装 Python 3 后，在仓库目录执行：

```bash
python -m http.server 8899 --bind 127.0.0.1
```

浏览器访问 `http://127.0.0.1:8899/`。不要直接双击 HTML 文件，ES modules 需要通过 HTTP 加载。无需 pip/npm 安装。

也可直接把仓库内容放入任意静态网站托管服务。所有静态资源使用相对路径，兼容子目录部署。

## 精简边界

- 这是界面预览，未接入支付、订单、登录、自动发货或数据库。
- 页面文案与价格数据保留当前版本，金额为展示示例。
- 不携带旧博客或 Next.js 镜像，页脚“探索更多”链接指向首页现有指南。
- 不携带第三方字体，改用操作系统自带字体，字体外观可能随设备不同。
- Logo 使用项目提供的橙色 G 原图。
