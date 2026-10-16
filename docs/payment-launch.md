# 微信与支付宝支付交付及资料清单

本次范围为 `/verify/` 已有审核订单：付款 ¥330 → 微信 Native / 支付宝当面付 → 验签确认到账 → 人工审核 → 通过完成，未通过原路退 ¥300，技术费 ¥30 保留。双二维码重复付款全额退回第二笔。普通商品仍沿用人工询价、核款和交付，没有增加商品价格。

当前版本保留页面布局、配色与组件，已按本轮方案修复后台错单、服务开放门槛和查询授权。正式接单必须先有完整已批准的服务定义、有效支持渠道与后台密码，再完成商户配置和真实验收；不是填完密钥就自动开放。用户确认支持时段 09:00–23:00、必须使用 Session Key，渠道和时区仍待补。

历史状态：PR #11 已合并，`8b56b70` 在 [run 38657522084](https://github.com/JackNiu2026/GetToken/actions/runs/38657522084) 部署成功，当时 API 为 off。本轮 PR 尚未合并部署，当前生产状态需上线时重新检查；从未将模拟验收视作真实资金验收。

## 已完成

- 支付宝 RSA2 请求签名、响应验签、收款 AppID/PID 校验、订单号绑定、查单与关单。
- 微信 APIv3 请求签名、公钥验签、通知 AES-GCM 解密、商户/AppID/订单/币种核对。
- 金额核对、平台交易号防复用、重复通知幂等、预下单并发合并、漏通知查单补偿。
- 微信退款通知验签，退款金额、原支付单、平台交易号匹配后才更新。退款成功不被迟到响应或后续异常通知覆盖。
- 支付宝退款 `fund_change=Y` 确认成功，`N` 查询；查询返回 `REFUND_SUCCESS` 才记成功，不把接口查询成功当成资金退款成功。
- 请求退款前持久化处理中状态，超时或重启后先查原退款单；确认没有执行时复用原编号重试。并发退款合并，异常持续跟踪，后台和 CLI 能查看原因。
- 双渠道配置导入、RSA 检查、微信证书/私钥配对及有效期检查、数据库加密密钥保留、配置失败回滚、服务器开放开关。
- API 安装或代理检查失败阻止发布；网站发布失败同时恢复上一版 API，保留财务数据库。

## 你最后需要提供的资料

| 项目 | 必须提供 | 说明 |
| --- | --- | --- |
| 支付宝 | 应用 APPID、收款商户 PID（2088 开头）、支付宝公钥；已有应用的匹配私钥 | 已上线、签约当面付，公钥模式与 RSA2。新应用私钥可在服务器生成，你只需把生成的应用公钥上传到开放平台 |
| 微信 | 商户号、绑定的 APPID、32 位 APIv3 密钥、`apiclient_key.pem`、`apiclient_cert.pem`、微信支付公钥及 `PUB_KEY_ID_…` | 已开通 Native，使用 APIv3 和微信支付公钥模式；证书序列号自动提取 |
| 服务资料 | 真实服务主体、客服渠道、支持时区、具体协助动作、交付证据、授权及超时处理 | 见 `verify-rules.mjs` 的 `SERVICE_CONTRACT`，当前未完整，不开放新订单 |
| 部署复核 | 现有 GitHub 部署链路、正式 HTTPS 回调与历史订单迁移 | 部署凭据已有历史成功证据，先复核现有配置，不要求重复提交；生产历史订单按迁移文档处理 |

没有商户账户时，先在 [微信支付商户平台](https://pay.weixin.qq.com/) / [支付宝开放平台](https://open.alipay.com/) 完成主体、经营信息、结算账户等申请及签约，具体资料以平台要求为准。已有账户只需上表参数和密钥，不必重复把主体证件交到仓库。

填写 [payment-merchant.example.json](payment-merchant.example.json)，真实文件命名为 `payment-merchant.json`，与密钥放在服务器私有目录并设为 600 权限。真实资料不入仓库或网站发布包；私钥和 APIv3 密钥通过服务器或受保护的 Secrets 提供，不在聊天或日志打印。

## 资料齐备后的执行流程

以下由部署维护方执行。先满足服务定义与历史查询权限迁移，再导入商户配置；已具备支付接口，不需要用户编写支付程序。

1. 按 [查询权限迁移](order-access-migration.md) 检查并完成历史订单私密链接交接。确认服务定义与支持信息完整后发布 API 包，它会安装 `gettoken-configure-payments`、`gettoken-payment-opening` 与 `gettoken-verify`。
2. 新支付宝应用需要生成密钥时，在服务器执行：

   ```bash
   sudo /opt/gettoken/runtime/node-v22.22.0-linux-x64/bin/node \
     /opt/gettoken/verify/current/server/verify/onboard.mjs keys /etc/gettoken/enrollment
   ```

   把生成的 `alipay_app_public.pem` 公钥配置到支付宝应用 RSA2 公钥，私钥留在服务器。已有应用沿用原匹配私钥。
3. 如未设置后台密码，执行 `sudo gettoken-verify passwd`。导入资料并检查：

   ```bash
   sudo gettoken-configure-payments /root/gettoken-payment/payment-merchant.json
   sudo gettoken-verify doctor
   ```

   导入使用正式接口、保留 `VERIFY_SECRET`、校验证书配对，并保持新订单关闭。`doctor` 仅证明本地配置及密钥格式正确，不证明平台签约/绑定和真实到账。
4. 核对正式 HTTPS `/api/verify/health` 返回 `ok:true,mode:live`，公网 POST 能到达：

   - 支付宝：`https://gettoken.cc/api/verify/notify/alipay`
   - 微信收款：`https://gettoken.cc/api/verify/notify/wechat`
   - 微信退款：`https://gettoken.cc/api/verify/notify/wechat/refund`

   程序自动把通知地址传给支付平台，不需要你编写回调程序。
5. 在可控窗口执行 `sudo gettoken-payment-opening open`，两个渠道各完成一笔真实订单，核对平台到账与服务器通知，然后录入未通过、核对原账户退回 ¥300。每笔付款 ¥330，技术费 ¥30 按现有规则不退；模拟验收不能证明实际资金到账。付款账户的持有人需要实际扫码确认支付。
6. 验收通过继续开放；平台配置有问题则执行 `sudo gettoken-payment-opening close`，历史查单与退款继续。

本轮已修复后台切单竞态。网页审核仍应核对订单号和证据摘要；CLI 可作为明确订单号的备用操作方式：

```bash
sudo gettoken-verify decision GT-VF-1014-XXXXXX failed '具体未通过原因，不含凭据'
sudo gettoken-verify decision GT-VF-1014-XXXXXX passed '已完成的约定动作与交付证据摘要，不代表官方结果'
sudo gettoken-verify reconcile GT-VF-1014-XXXXXX
```

CLI 返回状态及退款进度，不打印完整代码。真实审核仍由审核员完成，支付系统不判断代码有效性。微信退款 `ABNORMAL`（如原银行卡冻结）保留原因并持续查询，商户需在支付平台处理账户异常。

## 验收与实际状态

支付签名、回调、补单、退款与重启恢复已经通过隔离夹具和本地 Nginx/TLS 检查；本轮最终测试及证据见 [迭代验收](iteration-acceptance.md)。真实平台到账和退款仍未验收，本轮也未部署。

真实验收按现有规则两个渠道各付款 ¥330、失败各退 ¥300；合计付款 ¥660、预计退 ¥600、保留技术费 ¥60，平台手续费以实际账单为准。付款账户持有人须本人确认，不擅自修改生产收费。核对支付平台记录、服务器状态与原账户退款到账，保存脱敏证据；异常立即关闭新增接单，历史补单和退款继续。

商户资料、客服、服务定义或历史订单恢复条件有任一未满足，都应在验收表中明确待办，不写为已开放或全部完成。

协议参考：[微信退款结果通知](https://pay.wechatpay.cn/doc/v3/merchant/4012791906)、[支付宝退款查询](https://opendocs.alipay.com/open/7be83133_alipay.trade.fastpay.refund.query)。
