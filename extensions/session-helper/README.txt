GetToken Session Key 助手 0.1.0（测试版，真实安装验收待完成）

仅适用于桌面 Chrome / Edge 普通窗口。Claude 和 GetToken 必须在同一浏览器资料中打开。
已登录 Claude 的用户无需重新登录。安装后请刷新 https://gettoken.cc/verify/?helper=1。

首次安装（开发者模式；尚未上架浏览器商店）：
1. 将安装包解压到固定目录，不要删除该目录。
2. 打开 chrome://extensions/ 或 edge://extensions/。
3. 开启“开发者模式”，选择“加载已解压的扩展程序”，选择含 manifest.json 的目录。
4. 打开 https://gettoken.cc/verify/?helper=1 并刷新，点击输入框上方“获取已登录的 Session Key”。
5. 在扩展窗口确认来源、回填网站及授权，再允许访问 Claude Cookie。
6. 核对回填内容后，自行确认网站的提交授权并点击提交。

权限和隐私：
- cookies：只在上述授权流程中读取 claude.ai 的 sessionKey。
- Claude 站点访问：按需请求；拒绝后不读取。
- GetToken 页面脚本：仅 https://gettoken.cc/verify/，不运行于其他页面或 iframe。
- storage.session：只保存两分钟内的请求编号、来源标签页及文档编号；不保存凭据。
- 不读取浏览历史、密码、其他站点的 Cookie；不后台监控登录变化。
- 不记录、联网传输、写入剪贴板或保存 Session Key；凭据仅回填到网页输入框。
- 回填后网页可访问该值；点击网页提交后，GetToken 服务端会按页面规则处理。
- Session Key 是账号登录凭证，持有者可能访问账户；不是 API Key 或身份证明。
- GetToken 是独立第三方，非 Anthropic 官方认证入口。只操作本人账户。
- 不支持跨浏览器、跨用户资料、无痕模式或手机浏览器。
- 若会话已过期或撤销，需要在 Claude 本人登录后重试；读取成功不证明凭据有效。

卸载：在浏览器扩展管理页移除本扩展；可在扩展详情中撤销 Claude 站点访问授权。
卸载扩展不会撤销已交给网站的会话。需要时请在 Claude 的官方账号设置中撤销相关会话。

源码：https://github.com/JackNiu2026/GetToken/tree/main/extensions/session-helper
