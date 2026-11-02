# SOCKS5 转 Clash Verge 订阅

页面路径 `/clash/`，入口位于全站导航“订阅转换”、住宅 IP 页和全站页脚。页面由 `scripts/build-site.mjs` 从 `content/clash-page.mjs` 生成，不能直接修改生成的 HTML。

支持的输入（每行一个，最多 100 个，总计最多 12000 字符）：

```text
socks5://user:password@203.0.113.10:1080#节点名称
203.0.113.20:1080:user:password
user:password@proxy.example:1080
203.0.113.30:1080
[2001:db8::1]:1080:user:password
```

以上地址仅用于说明格式。SOCKS5 URI 中的账号、密码和节点名称使用百分号编码；冒号格式会保留密码中的冒号。账号密码需同时提供，端口为 1–65535。配置默认关闭 UDP，使用 PROXY 手选节点组和 MATCH 规则；DIRECT 可直连。转换不会测试代理连通性。

前端与后端共用 `assets/gettoken/clash-config.mjs`，以相同规则校验并生成 YAML。下载完全在浏览器执行，不调用 API。生成订阅会向本站发送配置，服务使用现有 `VERIFY_SECRET` 加密保存到 SQLite 的 `clash_subscriptions` 表，使用随机访问令牌与独立撤销令牌，并仅保存令牌的 SHA-256 摘要。访问令牌出现在订阅 URL 路径中，不含代理凭据。

- `POST /api/clash/subscriptions`：JSON `{ source, name, udp }`，需 `X-GetToken-Clash: 1`，有 Origin 时须与 `VERIFY_PUBLIC_ORIGIN` 一致。返回 `path`、`manageToken`、`expiresAt`、`count`。
- `GET` / `HEAD /api/clash/subscriptions/:token`：直接返回 Clash YAML，不依赖网页 Cookie 或浏览器登录，Clash Verge 可独立拉取。
- `DELETE /api/clash/subscriptions/:token`：通过 `X-GetToken-Clash-Manage` 提供撤销令牌，立即使对应链接失效。

链接有效期为 30 天，每个客户端每小时最多尝试生成 20 次，在线记录上限 5000。响应禁止缓存与索引。Nginx 对该接口关闭 access log；应用不打印输入或令牌。维护任务每分钟清理过期配置，并从托管备份清除已撤销和过期订阅，防止恢复备份时复活旧链接。无法清除用户客户端已下载的配置。

重新生成成功后会撤销本页的上一个链接；撤销失败有明确提示。撤销令牌仅驻留当前页面内存，刷新后无法主动撤销旧链接，旧链接会按期失效。订阅链接本身是私密访问凭据，请勿公开分享。

## 部署

沿用既有 Node 22+ 审核服务和 Nginx，服务即使关闭审核受理也能运行转换接口。无需新增密钥或端口。`VERIFY_PUBLIC_ORIGIN` 应为用户实际访问的 HTTPS 源。

需同时更新静态发布包、后端包和 `scripts/nginx-seo-locations.conf`；只上传静态页面时仍能下载 YAML，但不能生成远程订阅。

```bash
node scripts/build-site.mjs
node scripts/build-site.mjs --check
node --test tests/*.test.mjs
node scripts/package-site.mjs
node scripts/package-verify.mjs
```

部署继续使用 `DEPLOYMENT.md` 的现有流水线。新后端模块及共享生成器已纳入后端包，页面及资源由静态包一并发布。不要将数据库、运行时密钥或用户代理配置放进公开静态资源。
