# 云服务器部署

部署目标：`39.97.40.89`，SSH 用户：`root`。网站为纯静态页面；服务器需要 Nginx、curl 和 Python 3，不需要 Node.js、数据库或构建工具。Python 只用于更新域名的 SEO 路由与回滚，不运行网站服务。安装脚本支持 apt、dnf、yum 和 systemd。Node.js 用于本地和 GitHub Actions 的生成、打包与验证。

## 首次配置

1. 确认 SSH 服务的实际端口，云安全组允许 SSH 连接；云安全组和操作系统防火墙允许 HTTP 入站 TCP 80。
2. 在可信的服务器控制台执行以下命令，复制 SSH 主机公钥（这是服务器身份公钥，和登录用的 `.pem` 私钥不同）：

   ```bash
   for file in /etc/ssh/ssh_host_*_key.pub; do
     awk '{print "39.97.40.89 " $1 " " $2}' "$file"
   done
   ```

   如果 SSH 使用非 22 端口，把输出每行的 `39.97.40.89` 改成 `[39.97.40.89]:端口`。

3. 打开 [仓库 Actions Secrets 设置](https://github.com/JackNiu2026/GetToken/settings/secrets/actions)，添加两个 repository secrets：

   | Secret | 内容 |
   |---|---|
   | `GETTOKEN_SSH_KEY` | `.pem` 私钥文件的完整内容，包括 BEGIN/END 行 |
   | `GETTOKEN_KNOWN_HOSTS` | 上一步得到的 SSH 主机公钥行 |

   私钥只保存在 GitHub 的加密 Secrets 中，不要提交到仓库，也不要写入 workflow 文件。

4. 默认连接地址、用户、端口已经在 workflow 中设置。如需修改，在 [Actions Variables 设置](https://github.com/JackNiu2026/GetToken/settings/variables/actions) 添加 `GETTOKEN_HOST`、`GETTOKEN_USER` 或 `GETTOKEN_PORT`。当前安装脚本要求 root。
5. 打开 [Actions](https://github.com/JackNiu2026/GetToken/actions/workflows/deploy.yml)，选择 **Test and deploy GetToken → Run workflow → main**。第一次运行会安装 Nginx 并发布网站。

后续推送或合并到 `main` 会自动测试和部署。PR 只运行测试，不接触生产密钥或服务器。Secrets 未配置时，测试仍然运行，部署步骤会明确提示缺少哪项配置。

## 发布过程

- CI 检查 JavaScript 与 Shell 语法、生成页面是否同步（产品页、指南与首页“最新动态”）、首页不再含价格区，并通过 `scripts/package-site.mjs` 打包首页、五个产品页（`/codex/` `/claude/` `/gemini/` `/grok/` `/ip/`）、`/guides/` 下的指南首页、专题页、文章、RSS、资源、robots 和 sitemap。
- SSH 使用固定的服务器公钥验证身份，临时密钥文件在任务结束时删除。
- 每次发布创建独立目录 `/var/www/gettoken/releases/<提交 SHA>.<随机后缀>/`。
- `/var/www/gettoken/current` 原子切换到新目录，Nginx 配置位于 `/etc/nginx/conf.d/gettoken.conf`。
- 配置专门为 `.mjs` 设置 JavaScript MIME 类型，避免浏览器拒绝加载模块。
- SEO 别名规则保存在 `/var/www/gettoken/seo-locations.conf`。脚本从实际加载的 Nginx 配置中寻找 `gettoken.cc`、`www.gettoken.cc` 的站点，仅在根目录为 `/var/www/gettoken/current` 时追加规则 include，保留现有首页、TLS、证书与其他路由；根目录不符会中止发布。
- 同时打包 `server/verify/`（`scripts/package-verify.mjs` → `verify-api.tar.gz`），安装审核验证服务，见下文。
- 切换后检查 sitemap 列出的全部页面、robots、资源、404、SEO 网址重定向、JavaScript MIME 类型和 `deployment.json` 中的提交 SHA；失败时恢复之前的链接和 Nginx 配置。
- 域名配置与原 SEO 规则先存入权限为 700 的临时备份目录，失败时恢复原字节和权限，成功后清理；恢复异常时保留私有备份并报告错误。
- GitHub runner 随后检查实际 HTTPS 域名的全部页面、正文一致性、SEO 别名、HTTP→HTTPS 和公开部署版本，不再只以 IP 站点检查作为发布验收。
- GitHub 同时只执行一个生产部署；服务器用文件锁防止不同入口并发发布。

Nginx 使用 `server_name 39.97.40.89`，不会删除现有站点配置。已有应用如果占用端口 80，先确认服务器的托管方式，避免直接启动另一套服务。

## 手动部署

使用同一套脚本可以部署一个确定的版本：

```bash
git checkout main
git pull --ff-only
node --test tests/*.test.mjs
node scripts/build-site.mjs --check
node scripts/package-site.mjs
export DEPLOY_HOST=39.97.40.89 DEPLOY_USER=root DEPLOY_PORT=22
export DEPLOY_REVISION="$(git rev-parse HEAD)"
export DEPLOY_SSH_KEY="$(cat /安全目录/GetToken.pem)"
export DEPLOY_KNOWN_HOSTS="$(cat /安全目录/gettoken_known_hosts)"
bash scripts/deploy-ssh.sh
unset DEPLOY_SSH_KEY DEPLOY_KNOWN_HOSTS
```

请保持私钥文件权限为 `600`。脚本不会输出密钥内容。

## 回滚

检查当前和历史版本：

```bash
readlink -f /var/www/gettoken/current
ls -dt /var/www/gettoken/releases/*
```

确认需要恢复的目录后，在服务器执行（替换占位路径）：

```bash
flock /var/lock/gettoken-deploy.lock bash -c '
  ln -s /var/www/gettoken/releases/目标版本目录 /var/www/gettoken/.rollback
  mv -Tf /var/www/gettoken/.rollback /var/www/gettoken/current
  nginx -t && systemctl reload nginx
'
```

历史版本不会被自动删除，以便手动回滚。后续自动发布仍以 `main` 为准。

## 域名与正式销售配置

实际检查已确认 `gettoken.cc` 与 `www.gettoken.cc` 解析到该服务器，宝塔已有 HTTPS 站点且根目录为发布软链接。部署保留现有证书和域名配置，仅补充 SEO 地址规则。安装脚本的 IP 站点仍监听 HTTP 80，不负责签发或更换证书。价格、收款码和客服联系方式仍遵循 README 中的配置方式。

## 审核验证服务（/verify/ 与 /api/verify/）

`/verify/` 是静态页面，订单、付款、审核结果由同一台服务器上的小后端处理：

- 代码在 `server/verify/`，用 Node.js 自带的 SQLite，没有第三方依赖。每次发布随网站一起安装到 `/opt/gettoken/verify/releases/<提交 SHA>/`，`current` 软链接指向当前版本，保留最近 5 个版本。
- Node.js 固定为 v22.22.0 官方 linux-x64 版本（校验 SHA-256），首次发布时由 GitHub runner 下载后上传到 `/opt/gettoken/runtime/`。服务器需要 x86_64、glibc 2.28 以上；不满足时发布会给出警告并跳过后端，网站照常更新，审核页显示“服务暂时无法连接”。
- systemd 服务 `gettoken-verify` 以专用用户 `gettoken-verify` 运行，只监听 `127.0.0.1:8790`；Nginx 通过 `seo-locations.conf` 中的 `location ^~ /api/verify/` 转发。发布时先检查服务健康，失败则恢复上一个版本。
- 数据库：`/var/lib/gettoken-verify/verify.db`，每天自动备份到同目录 `backups/`，保留 14 天。用户提交的代码加密保存，出结果 7 天后自动删除（`VERIFY_PURGE_DAYS` 可调）。
- 日志：`journalctl -u gettoken-verify -f`。

### 第一次上线后

1. 设置后台密码（至少 12 位）：`sudo gettoken-verify passwd`。后台地址 `https://gettoken.cc/verify/admin/`，robots 已禁止收录。
2. 配置文件 `/etc/gettoken/verify.env` 在首次发布时自动生成，只有 root 可读，之后的发布不会覆盖。其中的 `VERIFY_SECRET` 用于加密代码，**不要修改或丢失**，换掉后已有订单的代码无法解密。
3. 刚安装时 `VERIFY_PAY_MODE=off`，页面显示“在线支付暂未开通”。查看状态：`sudo gettoken-verify status`。
4. 修改 `verify.env` 后执行 `sudo systemctl restart gettoken-verify`。

### 测试模式

`VERIFY_PAY_MODE=mock`：不接任何支付平台，付款二维码只是测试内容；在后台点开订单，用“模拟收款”让订单进入审核，“未通过”时退款也是模拟的。页面顶部会显示“测试模式”。验收完改回 `live` 或 `off`，不要长期开着。

### 接入支付宝与微信支付

密钥文件放在 `/etc/gettoken/keys/`（发布时自动设为 root:gettoken-verify、640），路径写进 `verify.env`。异步通知地址由程序自动生成，必须能从公网 HTTPS 访问：

- 支付宝：`https://gettoken.cc/api/verify/notify/alipay`
- 微信支付：`https://gettoken.cc/api/verify/notify/wechat`

**支付宝（当面付，公钥模式）**：在支付宝开放平台创建应用并签约“当面付”，接口加签方式选“公钥”、RSA2，上传应用公钥，下载支付宝公钥。

```ini
ALIPAY_APP_ID=2021xxxxxxxxxxxx
ALIPAY_PRIVATE_KEY_FILE=/etc/gettoken/keys/alipay_app_private.pem
ALIPAY_PUBLIC_KEY_FILE=/etc/gettoken/keys/alipay_public.pem
```

**微信支付（Native 扫码，APIv3，微信支付公钥模式）**：商户号需开通 Native 支付并绑定一个 AppID；在商户平台设置 APIv3 密钥、申请 API 证书（得到 `apiclient_key.pem` 与证书序列号），下载“微信支付公钥”并记下公钥 ID（`PUB_KEY_ID_` 开头）。

```ini
WECHAT_MCHID=1900000000
WECHAT_APPID=wx0000000000000000
WECHAT_SERIAL_NO=商户 API 证书序列号
WECHAT_APIV3_KEY=32 位 APIv3 密钥
WECHAT_PRIVATE_KEY_FILE=/etc/gettoken/keys/apiclient_key.pem
WECHAT_PAY_PUBLIC_KEY_FILE=/etc/gettoken/keys/wechatpay_public.pem
WECHAT_PAY_PUBLIC_KEY_ID=PUB_KEY_ID_xxxxxxxx
```

配置完成后把 `VERIFY_PAY_MODE` 改为 `live` 并重启。只配置了一种时，页面只显示那一种；两种都配置时用户可以切换。`sudo gettoken-verify status` 会列出可用的付款方式。

付款成功由支付平台的异步通知确认，页面每 3 秒查询一次订单，并在需要时主动向平台查单，所以通知偶尔丢失也不影响。审核结果只能在后台录入：点“未通过”会立即原路退回审核费 ¥300（技术费 ¥30 不退），退款失败时后台显示原因，可以点“重试”；同一订单被重复付款时，多付的一笔自动全额退回。

## SEO 发布验收

CI 在打包后通过真实 Nginx 容器验证发布模板与目录页行为。容器仅用于测试，不是部署目标。新增 SEO 地址的 `index.html` 别名及无末尾斜线地址使用相对 301，并保留查询参数，适用于 HTTPS 代理后的入口；目录请求的内部索引不会进入重定向循环。

正式域名配置完成后，在可以访问该域名的环境中运行：

```bash
node scripts/check-live-seo.mjs --revision "$(git rev-parse HEAD)" --output /tmp/gettoken-live-seo.json
```

默认要求 HTTPS；检查 canonical 页面 200、正文与本次构建一致、部署版本、HTTP 到 HTTPS、robots 对 Googlebot 与 Baiduspider 的允许规则、sitemap、日期、资源、404 与 SEO 别名。请求通过不表示搜索平台已收录或已有排名。产品页与指南都是目录网址：`/claude`、`/claude/index.html` 这类写法由 `scripts/nginx-seo-locations.conf` 301 到 `/claude/`；旧的 `/navigation/` 301 到 `/guides/`。
