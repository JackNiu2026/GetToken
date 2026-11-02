# SOCKS5 转 Clash / 小火箭订阅

页面路径 `/clash/`，入口位于全站导航“订阅转换”、住宅 IP 页和全站页脚。页面由 `scripts/build-site.mjs` 从 `content/clash-page.mjs` 生成，不能直接修改生成的 HTML。

支持的输入（每行一个，最多 100 个，总计最多 12000 字符）：

```text
socks5://user:password@203.0.113.10:1080#节点名称
203.0.113.20:1080:user:password
user:password@proxy.example:1080
203.0.113.30:1080
[2001:db8::1]:1080:user:password
socks5h://user:password@proxy.example:1080
socks://dXNlcjpwYXNzd29yZA==@203.0.113.10:1080#Base64用户信息
socks://dXNlcjpwYXNzd29yZEAyMDMuMC4xMTMuMTA6MTA4MA==?remarks=旧版完整编码
```

以上地址仅用于说明格式。还支持 `socks5://IP:端口:账号:密码`；该形式的凭据按 URI 百分号编码解码。SOCKS5 URI 中的账号、密码和节点名称使用百分号编码，原始冒号格式则保留密码中的冒号、百分号、@ 和末尾空格，不进行解码。Base64 支持完整地址或用户信息两种形式、标准或 URL-safe 字符表以及省略 padding；Base64 内的凭据作为原文处理，不额外百分号解码。混合格式可逐行输入，兼容 CRLF、CR、BOM 和行首缩进。无协议字符串若同时符合供应商冒号格式及凭据@端点格式，会明确报错要求改用 `socks5://`，不会猜测并静默切换服务器。

账号密码需同时提供，其 UTF-8 编码各为 1–255 字节；端口为 1–65535，IPv6 需加方括号。明确拒绝 SOCKS4、HTTP、SOCKS5+TLS、未知查询参数及路径，避免丢弃传输设置后生成错误配置。允许节点名称使用 `#名称`、`?remarks=名称` 或 `?remark=名称`。`socks5h://` 使用相同 SOCKS5 连接配置，由客户端传递域名给代理解析。

选择 Clash 时输出完整配置：默认关闭 UDP，使用 PROXY 手选节点组和 MATCH 规则；DIRECT 可直连。选择小火箭时输出只含 `proxies` 的 YAML 节点订阅，沿用 [Sub-Store 的 Shadowrocket 输出结构](https://github.com/sub-store-org/Sub-Store/blob/master/backend/src/core/proxy-utils/producers/shadowrocket.js)，不覆盖现有路由规则。采用结构化节点字段，避免 URI 分隔符损坏包含冒号的用户名或密码。小火箭导入地址使用标准 Base64 的 `shadowrocket://add/sub://...`。

前端与后端共用 `assets/gettoken/clash-config.mjs`，以相同规则校验并生成 YAML。下载完全在浏览器执行，不调用 API。生成订阅会向本站发送配置，服务使用现有 `VERIFY_SECRET` 加密保存到 SQLite 的 `clash_subscriptions` 表，使用随机访问令牌与独立撤销令牌，并仅保存令牌的 SHA-256 摘要。访问令牌出现在订阅 URL 路径中，不含代理凭据。

- `POST /api/clash/subscriptions`：JSON `{ source, name, udp, format }`，`format` 为 `clash`（默认）或 `shadowrocket`。需 `X-GetToken-Clash: 1`，有 Origin 时须与 `VERIFY_PUBLIC_ORIGIN` 一致。返回 `path`、`manageToken`、`expiresAt`、`count`、`format`。
- `GET` / `HEAD /api/clash/subscriptions/:token`：返回生成时所选格式的 YAML，不依赖网页 Cookie 或浏览器登录，客户端可独立拉取。旧记录通过数据库增量迁移保持 `clash` 格式；旧链接和密文均保留。
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

## 兼容性验证

`tests/helpers/socks-cases.mjs` 提供 54 组独立预期值，覆盖多种 URI / Base64 / 冒号格式、IPv6、端口边界、中文与 emoji、密码中的冒号、@、百分号、URL 符号、末尾空格及数字样式。转换测试核对各字段，不仅检查配置能否解析；另有 255 字节认证边界、旧链接迁移和两种订阅的 HTTP 拉取 / 撤销回归。

2026-11-02 复核：两种输出均经独立 PyYAML 解析器核对全部 54 个节点的原始凭据；Clash 完整配置通过官方 Mihomo v1.19.33 的 `-t` 校验。另使用本机模拟 SOCKS5 服务，让真实 Mihomo 完成 6 组连接认证，确认复杂密码、用户名中的冒号、Base64、Unicode 和 255 字节密码的实际传输字节均未改变。

小火箭输出已对照 Sub-Store 的现行生产器和 YAML 节点结构，但未进行 iOS 实机导入测试。格式正确不保证代理服务器在线、凭据有效或支持 UDP；本工具不探测用户输入的远程代理。


## 本地导入和分流选项

页面优先展示“下载 YAML，本地导入”：Clash Verge 的订阅页新建 Local（本地）配置，导入下载文件、保存并选中，在 PROXY 分组选中节点，再开启系统代理或按需开启 TUN。远程方式则生成 HTTPS 链接并在客户端订阅页导入；原始 socks5:// 链接不等同于远程 YAML 订阅 URL。

Clash 新增 `routing` 参数，默认 `all` 保持原有 MATCH,PROXY；`bypass-cn` 在末尾代理规则之前添加 IPv4/IPv6 回环、私网和链路本地地址直连，以及 GEOIP,CN,DIRECT。需客户端使用规则模式并具备可用 GeoIP 数据库，不包含域名分流。小火箭输出仍只有 proxies 节点列表，不附带 Clash 规则。已有订阅内容不变，修改选项后须生成新链接或重新下载文件。

UDP 默认关闭，仅在供应商支持时启用；不是认证失败的修复手段。转换只验证格式，不探测真实代理。生成、下载后展示对应的导入步骤，并明确尚未测试代理连通性。不要将真实凭据写入示例或提交到仓库，secret Gist 也可被持有链接者读取。

## 手动组链节点（Clash Verge Rev v2.4.5+）

选择“手动组链”，填写原始前置节点订阅的 HTTPS URL，以及住宅 SOCKS5。共享构建函数参数为 `connection: 'direct' | 'chain'`（默认 direct）和 `upstreamUrl`。chain 生成的是供客户端手动组链的节点配置，不是自动组好的代理链。前置 URL 最多 4096 字符，禁止 URL 登录信息、片段、控制字符和本站生成的订阅 URL；错误不回显 URL。直连忽略未使用的前置 URL；小火箭拒绝 chain。

只有一个可见的“链式节点”select 组：`proxies` 列出住宅节点，`use: [upstream]` 同时加入前置 provider 节点。前置统一加“前置 · ”前缀，住宅统一加“住宅 · ”前缀，防止重名。无隐藏分组，无自动选前置逻辑，住宅节点不预设 dialer-proxy，避免与客户端的“链式代理”功能重复组链。前置 provider 覆盖旧 dialer-proxy 为 DIRECT，只导入独立出站节点，排除 direct/reject/dns/compatible。

导入并选中该配置后，等待前置加载；“链式节点”组会同时出现两类节点。点击客户端右上角“链式代理”，按“前置节点（入口、在上）→住宅 SOCKS5（出口、在下）”的顺序配置并保存启用。仅把节点放同组、或只选中一个节点都不会自动串联。连接路径应为电脑 → 选中的前置 → 选中的住宅 SOCKS5 → 网站。客户端的代理链配置负责添加实际 dialer 关联；网站仅准备节点池。

`proxy-providers.upstream` 每小时由客户端直接更新，推荐返回含 proxies 列表的 Clash YAML；仅引用其他 provider 而不含节点的配置不可直接用。网站不请求或验证前置链接，首次加载要求客户端能直接访问该 HTTPS 地址。订阅更新后，若原前置被删除或失效，需在客户端重新选择并保存代理链；不承诺客户端保存的链自动跟随远程节点变化。

生成链接会将含前置订阅令牌的完整 YAML 加密存储 30 天，链接持有人可读取全部内容；仅下载文件不上传本站。旧链接是旧配置快照，需重新生成并替换，才能使用同组节点池。

可选内核检查：`node tests/helpers/mihomo-chain.mjs /path/to/mihomo`。使用本地 HTTPS 订阅和认证 SOCKS5 服务，验证核心 API 的同组节点列表，并模拟客户端应用前后节点的 dialer 关系，检查两段连接、出口切换和重新选择前置；不等同于启动了真实 Clash Verge UI。需要 openssl 和 Mihomo。
