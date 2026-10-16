# GetToken 本轮迭代验收与交接

日期：2026-10-16（America/New_York）。基线 `8b56b70e56058c6b508676ce5b4c83671c83a148`；功能与页面验收版本 `8106c891817eeff2197ab04271c374aaf7ea6c1b`，PR-08 仅汇总文档与证据。结构化结果见 [iteration-acceptance.json](iteration-acceptance.json)。

## 交付结论

| 项目 | 结论 | 证据及边界 |
| --- | --- | --- |
| 本轮代码实现 | 本地验收通过，已拆分提交 PR | PR-01～07 完成；PR-08 为本次验收交接 |
| 页面保留要求 | 通过 | 全部 CSS、核心动效文件与 main 一致；28 页桌面/手机检查正常，保留布局、配色、组件与 URL |
| 普通商品受理 | 保持关闭 | 15 档供应与真实支持渠道未确认；空配置显示暂未受理，不提供占位付款 |
| KYC 服务开放 | 保持关闭 | 用户要求保留 Session Key、时段为 09:00–23:00；服务动作、证据、渠道和时区等仍待填 |
| 新订单查询授权 | 隔离环境通过 | 裸订单号、错误或跨单凭据无法读取；正确私密链接、刷新、恢复/轮换可用 |
| 生产存量迁移 | 未执行 | 尚无生产盘点及恢复交接证据；存在未迁移订单时阻止切换版本 |
| 微信/支付宝真实资金闭环 | 待商户及本人扫码验收 | 协议夹具与本地 TLS 通过，不代表真实到账或退款 |
| 本轮生产部署 | 未执行 | PR 未合并；main 合并会自动部署，不能在资料和迁移未就绪时直接放行 |

## PR 与验证记录

| 计划 | GitHub PR | 实现 | GitHub CI 证据 |
| --- | --- | --- | --- |
| 01 | [#12](https://github.com/JackNiu2026/GetToken/pull/12) | 后台详情/操作绑定、防重复及乱序保护 | [run 38856619075：成功](https://github.com/JackNiu2026/GetToken/actions/runs/38856619075) |
| 02 | [#13](https://github.com/JackNiu2026/GetToken/pull/13) | 询价受理与支持/供货配置联动 | [run 38856902289：成功](https://github.com/JackNiu2026/GetToken/actions/runs/38856902289) |
| 03 | [#14](https://github.com/JackNiu2026/GetToken/pull/14) | 商品事实、期限和交付承诺修正 | [run 38857176155：成功](https://github.com/JackNiu2026/GetToken/actions/runs/38857176155) |
| 04 | [#15](https://github.com/JackNiu2026/GetToken/pull/15) | 服务定义、授权说明和正式接单门槛 | [run 38857570062：成功](https://github.com/JackNiu2026/GetToken/actions/runs/38857570062) |
| 05 | [#16](https://github.com/JackNiu2026/GetToken/pull/16) | 查询凭据、历史迁移保护与私有索引 | [run 38886906431：成功](https://github.com/JackNiu2026/GetToken/actions/runs/38886906431) |
| 06 | [#17](https://github.com/JackNiu2026/GetToken/pull/17) | 分享元信息、首页 schema 和日期维护 | [run 38887096285：成功](https://github.com/JackNiu2026/GetToken/actions/runs/38887096285) |
| 07 | [#18](https://github.com/JackNiu2026/GetToken/pull/18) | 13 篇文章、6 个专题与指南入口 | [run 38887702280：成功](https://github.com/JackNiu2026/GetToken/actions/runs/38887702280) |
| 08 | 本文件所在验收 PR | 文档纠正、验收与运营交接 | 提交后以该 PR 检查页为准，不将本地检查冒充 GitHub CI |

PR-02～08 暂以此前依赖分支为 base，以便审查独立差异，尚未合并。集成时先确认前序 PR 已进入 main，再把下一 PR 改为 main，重新核对差异、通过 CI 后继续。不要把后续草稿合进尚未合并的前序分支。生产上线需先满足迁移检查；真实接单另受关闭开关保护。

## 本地验收

- Node 22.22.0：84 项 JavaScript 测试通过，含后台竞态、询价准备、服务开放、订单授权、签名回调、补单和退款恢复。
- Python：5 项路由保留和回滚测试通过。
- JavaScript、Shell、Python 语法与静态生成一致性通过；网站及审核 API 发布包能构建。
- 实际 Nginx：508 项 HTTP 检查、108 项域名路由检查通过；验证规范 URL、私有响应头、重定向、资源、gzip 与现有域名路径保留。
- 实际 Node 22.22.0 + Nginx + 本地受信任 TLS：21 项 API 联测通过，含模拟订单、到账、通过/失败、退款和持久化重启。
- 浏览器：28 页 × 桌面 1440×1000 / 手机 390×844，共 56 个基础视图，全部 HTTP 200、单一 H1，无页面横向溢出、坏图、脚本异常。禁用 JavaScript 时抽查首页、商品、文章、审核页的主要内容仍可阅读。
- 普通商品：桌面/手机共 90 次档位和周期选择均显示对应受理说明，未暴露空收款码付款。
- 后台：旧代码在回归测试失败；当前浏览器慢 A/快 B 场景显示 B、确认 B、提交 B、落库 B，A 不变。快速重选、失败、退出、重复操作和列表乱序另有回归。
- 私密查询：创建、刷新、裸订单号拒绝、跨浏览器链接、同页 fragment 导航、片段清理、结果证据显示通过；浏览器最近记录不含 Session Key。

本地证据目录：`.impeccable/review/iteration-01/`、`iteration-02/`、`iteration-04/`、`iteration-05/`、`iteration-acceptance-2026-10-16/`。最终目录含 `audit.json`、56 个基础视图及交互截图；只使用虚构订单、凭据与资金。原始截图不放公开业务数据库或 Git 仓库，汇总结果随本 PR 提交。

## 已知限制与交接

没有真实客服渠道，不能宣称咨询收发闭环完成；没有商户实单，不能宣称支付已开放；没有生产访问与迁移盘点，不能宣称本轮已上线；没有搜索平台或访问分析数据，不能宣称排名、收录或转化提升。

可靠首次公开日期、逐篇原创图片、独立关于/联系/条款/隐私/售后页面，以及分析平台接入留在后续范围。本轮用品牌图作分享回退，日期和示例不伪造。未完成完整 WCAG 或真实用户核心网页指标验收。

后续仅需按清单补实际资料并验收对应业务：[业务开放清单](business-readiness.md)、[询价登记](inquiry-operations.md)、[服务定义](verify-service-readiness.md)、[历史订单迁移](order-access-migration.md)、[商户及资金验收](payment-launch.md)、[漏斗测量口径](funnel-measurement.md)。

历史 PR #11 已部署、当时 API off 的记录已与本轮状态分开；旧恢复报告保留历史标识。发布异常优先关闭新增接单并前向修复，不覆盖财务数据库，不更换 `VERIFY_SECRET`，不回滚到绕过查询授权的旧 API。
