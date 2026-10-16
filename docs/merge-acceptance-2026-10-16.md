# 迭代 PR 合并验收记录

日期：2026-10-16（America/New_York）。状态：功能 PR #12～#18 已合并并部署验收通过；本文随 #19 同步发布。

## 合并方法与复核

逐项读取 PR、原及刷新后的 CI、评审和未解决讨论；未发现待处理评审。每个 PR 在前序进入 main 后改为以 main 为 base，核对 GitHub 测试合并树与受测分支的树一致，使用固定 head SHA 执行普通 merge。未强制绕过检查或开启接单。

为确认查询权限升级条件，在 PR #15 补充了生产只读汇总诊断：SQLite 使用只读连接和 query_only，仅查询数量及 schema，不读取账号、会话凭据或商户秘密。旧/新 schema、缺失数据库及数据库字节未改变的本地夹具检查通过；新增诊断后的依赖分支已同步并重跑 CI。

本轮复核整合候选的 84 项 JavaScript、5 项 Python 测试通过，静态生成检查通过。7 个 CSS 与核心动效文件与迭代起点 `8b56b70` 逐字节一致；现有 28 页/56 视图的证据对应的页面和组件未因本次合并额外修改。

## 生产订单前置条件

[只读检查 run 38915329615](https://github.com/JackNiu2026/GetToken/actions/runs/38915329615) 确认：数据库可读、订单总数 0、未迁移订单 0、待退款 0，审核服务 active。该检查在权限改动前完成。

[PR #16 部署 run 38915646320](https://github.com/JackNiu2026/GetToken/actions/runs/38915646320) 的候选安装器再次确认“待迁移查询权限的历史订单：0”后才切换 API。因此本轮无需签发历史用户恢复链接，没有删除任何订单或财务记录，也没有通过关闭迁移检查来发布。

## 已验收的功能发布

| PR | main 合并提交 | 部署与线上验收 |
| --- | --- | --- |
| [#12](https://github.com/JackNiu2026/GetToken/pull/12) | `3bdad1a93792ee27eef8b4145f9f2120830189f3` | [38914344130](https://github.com/JackNiu2026/GetToken/actions/runs/38914344130)，503 项检查通过 |
| [#13](https://github.com/JackNiu2026/GetToken/pull/13) | `596f2e02c672fb5d8774220fde4f30cf0c1f4057` | [38914630777](https://github.com/JackNiu2026/GetToken/actions/runs/38914630777)，503 项检查通过 |
| [#14](https://github.com/JackNiu2026/GetToken/pull/14) | `08cc8fdd493530c34033172055f1409ff49ad3da` | [38914955034](https://github.com/JackNiu2026/GetToken/actions/runs/38914955034)，503 项检查通过 |
| [#15](https://github.com/JackNiu2026/GetToken/pull/15) | `9a514f947b97c49836c7e39d5812edaaca2e4643` | [38915329769](https://github.com/JackNiu2026/GetToken/actions/runs/38915329769)，503 项检查通过 |
| [#16](https://github.com/JackNiu2026/GetToken/pull/16) | `ce3d7fe09b40dadd18323c3c89821c5c3efd48c3` | [38915646320](https://github.com/JackNiu2026/GetToken/actions/runs/38915646320)，510 项检查通过 |
| [#17](https://github.com/JackNiu2026/GetToken/pull/17) | `d6fab4124c05086ab4c7ad8c0c9dd1f88e54b6e9` | [38915958751](https://github.com/JackNiu2026/GetToken/actions/runs/38915958751)，510 项检查通过 |
| [#18](https://github.com/JackNiu2026/GetToken/pull/18) | `f89cf19e9542c03ee0f4106206be9c6e46ad2a21` | [38916282163](https://github.com/JackNiu2026/GetToken/actions/runs/38916282163)，510 项检查通过 |

#19 只同步文档和证据，更新后的 CI 与最终 merge/部署状态以 [PR 检查页](https://github.com/JackNiu2026/GetToken/pull/19) 为准，不预写尚未发生的提交 SHA。

验收依据为部署日志的版本匹配、`productionVerified: true` 与空 issues，并核对 API `ok:true, mode:off`；HTTP 验收不等于搜索引擎收录或排名，也不替代真实资金验收。

## 业务状态

网站代码可以在关闭受理状态下发布。普通商品仍不受理，KYC 的服务定义和商户未齐，`approved:false` 与关闭开关保持不变。没有执行真实付款、退款、凭据签发或收款开放；后续业务资料见 [业务清单](business-readiness.md)。
