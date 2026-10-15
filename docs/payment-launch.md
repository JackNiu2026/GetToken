# 微信与支付宝支付交付及资料清单

本次范围为 `/verify/` 已有审核订单：付款 ¥330 → 微信 Native / 支付宝当面付 → 验签确认到账 → 人工审核 → 通过完成，未通过原路退 ¥300，技术费 ¥30 保留。双二维码重复付款全额退回第二笔。普通商品仍沿用人工询价、核款和交付，没有增加商品价格。

页面布局、配色、组件与交互逻辑保持原样；按文案要求，审核页标题改为“Claude KYC认证”，输入项说明改为 Session Key，并明确本站为第三方协助、官方 KYC通过 Persona 完成。现有客户端读取服务器通道列表，商户齐备后通过服务器开关启用原有表单；“即将开放”状态保留。

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
| 服务器 | SSH 入口与凭据、校验用主机指纹、正式域名（默认 `gettoken.cc`） | 当前环境没有部署凭据，不能访问正式服务器和支付生产接口；需要部署环境网络可达及公网 HTTPS 回调 |

没有商户账户时，先在 [微信支付商户平台](https://pay.weixin.qq.com/) / [支付宝开放平台](https://open.alipay.com/) 完成主体、经营信息、结算账户等申请及签约，具体资料以平台要求为准。已有账户只需上表参数和密钥，不必重复把主体证件交到仓库。

填写 [payment-merchant.example.json](payment-merchant.example.json)，真实文件命名为 `payment-merchant.json`，与密钥放在服务器私有目录并设为 600 权限。真实资料不入仓库或网站发布包；私钥和 APIv3 密钥通过服务器或受保护的 Secrets 提供，不在聊天或日志打印。

## 资料齐备后的执行流程

以下由部署维护方执行，不需要再开发支付接口。

1. 发布 API 包，它会安装 `gettoken-configure-payments`、`gettoken-payment-opening` 与 `gettoken-verify`。
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

“不修改前端”约束下，前次发现的后台切换订单竞态补丁仍未应用。录入结果使用 CLI 绑定明确订单号，避免界面乱序导致看错代码：

```bash
sudo gettoken-verify decision GT-VF-1014-XXXXXX failed '审核未通过原因'
sudo gettoken-verify decision GT-VF-1014-XXXXXX passed
sudo gettoken-verify reconcile GT-VF-1014-XXXXXX
```

CLI 返回状态及退款进度，不打印完整代码。真实审核仍由审核员完成，支付系统不判断代码有效性。微信退款 `ABNORMAL`（如原银行卡冻结）保留原因并持续查询，商户需在支付平台处理账户异常。

## 验收与实际状态

- Node 22.22.0：71 个 JavaScript 测试；Python：5 个路由测试。
- 新增 9 个双渠道签名 HTTP 协议及服务场景、4 个商户配置场景、4 个发布失败/恢复场景。平台夹具独立检查签名字符串，返回 RSA 签名响应及 AES-GCM 通知，没有真实资金。
- API 发布包：21 项真实 Node 22.22.0、Nginx、本地受信任 TLS、登录、订单、人工结果、退款与重启恢复检查。
- 支付阶段浏览器使用原始页面检查双通道表单、二维码、到账审核中、退款展示与关闭提交；后续文案阶段再次检查桌面与手机共 12 个状态，确认运行时结构、组件样式和非文字 JavaScript 逻辑不变。

```bash
node --test tests/*.test.mjs
python3 -m unittest discover -s tests -p 'test_*.py'
node scripts/build-site.mjs --check
node scripts/test-verify-api.mjs
```

真实平台尚未验收，生产服务器尚未部署；未提交或推送，未把测试凭据作为正式商户。资料和部署入口齐备后完成生产到账核对。

协议参考：[微信退款结果通知](https://pay.wechatpay.cn/doc/v3/merchant/4012791906)、[支付宝退款查询](https://opendocs.alipay.com/open/7be83133_alipay.trade.fastpay.refund.query)。
