# Session Key 获取动画

`/verify/` 的 Session Key 输入框正上方提供“查看 Session Key 获取教程”。点击打开原生 dialog，播放 30 秒操作动画，可暂停、全屏、重播或按六个章节跳转；关闭或返回填写后原表单内容与授权选择保持原样。

动画顺序：已登录 Claude 后打开开发者工具 → Application → Storage / Cookies / https://claude.ai → 筛选并精确选中 sessionKey → 复制完整 Value → 返回表单粘贴。文字步骤同时列出 Windows/Linux 和 Mac 快捷键。复制演示明确要求先进入 Value 单元格，复制后用 Esc 退出，避免修改 Cookie。

这是按用户参考图重新绘制的虚构界面，示例值为 `sk-ant-sid02-EXAMPLE_ONLY`，长度不满足提交规则。未使用截图中的真实 Cookie、账号信息或浏览器存储；教程模块不访问 Cookie、剪贴板或真实输入值，不会回填示例或自动提交。

视频不会在页面加载时播放，关闭教程或切换到后台即暂停。开启减少动态效果偏好时不自动播放，直接展开完整文字步骤；用户仍可主动播放。视频不可用时显示文字回退。移动端可以观看和全屏，实际开发者工具操作需在电脑 Chrome/Edge 中进行。

## 资产与重制

- 步骤/字幕源：`content/session-key-guide.mjs`。
- 虚构浏览器画面：`scripts/session-key-guide/scene.html`。
- 导出脚本：`scripts/render-session-key-guide.mjs`，需要可用的 Playwright、Chromium 和 FFmpeg。通过 `GETTOKEN_PLAYWRIGHT_MODULE` 与 `GETTOKEN_CHROMIUM_BIN` 指定现有安装路径；不依赖真实浏览器资料或登录状态。
- 成品：`assets/gettoken/session-key-guide.mp4`、`.png` 和 `.vtt`，MP4 为 1280×900、30 秒、H.264/yuv420p、无音轨、faststart。生成后提交静态资产；部署与页面运行均无需视频渲染依赖。

Nginx 明确提供 MP4、WebVTT 类型和字节范围请求以支持拖动播放。CI 在打包后验证视频与字幕响应，部署后只读检查教程按钮位于输入框之前、扩展入口已撤下、MP4 可部分请求、字幕可用。这些交付检查不读取或提交任何凭据。

操作依据：[Chrome Cookies 面板](https://developer.chrome.com/docs/devtools/application/cookies)、[Chrome DevTools 快捷键](https://developer.chrome.com/docs/devtools/shortcuts)。这些资料不代表 Claude 对具体 Cookie 名称、会话有效性或身份认证结果的保证。
