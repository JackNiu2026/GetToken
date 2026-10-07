# 云服务器部署

部署目标：`39.97.40.89`，SSH 用户：`root`。网站为纯静态页面；服务器安装 Nginx 和 curl，不需要 Node.js、数据库或构建工具。安装脚本支持 apt、dnf、yum 和 systemd。Node.js 只用于 GitHub Actions 中的语法检查和产品目录测试。

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

- CI 检查 JavaScript 与 Shell 语法，运行目录测试，把 `index.html` 和 `assets/` 打包。
- SSH 使用固定的服务器公钥验证身份，临时密钥文件在任务结束时删除。
- 每次发布创建独立目录 `/var/www/gettoken/releases/<提交 SHA>.<随机后缀>/`。
- `/var/www/gettoken/current` 原子切换到新目录，Nginx 配置位于 `/etc/nginx/conf.d/gettoken.conf`。
- 配置专门为 `.mjs` 设置 JavaScript MIME 类型，避免浏览器拒绝加载模块。
- 切换后检查首页、CSS、JavaScript MIME 类型和 `deployment.json` 中的提交 SHA；失败时恢复之前的链接和 Nginx 配置。
- GitHub 同时只执行一个生产部署；服务器用文件锁防止不同入口并发发布。

Nginx 使用 `server_name 39.97.40.89`，不会删除现有站点配置。已有应用如果占用端口 80，先确认服务器的托管方式，避免直接启动另一套服务。

## 手动部署

使用同一套脚本可以部署一个确定的版本：

```bash
git checkout main
git pull --ff-only
node --test tests/*.test.mjs
tar -czf site.tar.gz index.html assets
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

目前先提供 HTTP/IP 访问；配置域名解析后再调整 `server_name` 并签发 HTTPS 证书。价格、收款码和客服联系方式仍遵循 README 中的配置方式；部署不会替你填入真实业务信息。
