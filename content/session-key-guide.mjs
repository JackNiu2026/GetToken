// One source for the video chapters, transcript and subtitles. Values in the
// rendered browser are fictional and deliberately not valid submit credentials.
export const KEY_GUIDE_STEPS = Object.freeze([
  { start: 0, end: 4, short: '打开工具', title: '登录 Claude，打开开发者工具', text: '在已登录的 claude.ai 页面按 F12。Windows / Linux 也可按 Ctrl+Shift+I；Mac 按 ⌘+⌥+I。' },
  { start: 4, end: 8, short: 'Application', title: '点击顶部的 Application（应用）标签', text: '在开发者工具顶部点击 Application（应用）。没有看到时，先展开顶部的 » 更多标签。' },
  { start: 8, end: 13, short: '选择站点', title: '展开 Cookies，选择 claude.ai', text: '在左侧 Storage（存储）下展开 Cookies，点击 https://claude.ai，确认选中的是这个站点。' },
  { start: 13, end: 18, short: '找到名称', title: '筛选并选中 sessionKey', text: '在 Filter（筛选）输入 sessionKey，选择 Name 恰好为 sessionKey 的行；不要选择 sessionKeyLC 等其他行。' },
  { start: 18, end: 24, short: '复制数值', title: '复制完整的 Value（值）', text: '双击该行的 Value 单元格，按 Ctrl+A、Ctrl+C 复制完整值，再按 Esc 退出编辑。Mac 使用 ⌘A、⌘C；不要修改或删除 Cookie。' },
  { start: 24, end: 30, short: '返回粘贴', title: '返回表单，粘贴后核对', text: '回到本站，在 Session Key 输入框粘贴完整值，只粘贴 Value，不要粘贴名称、截图或省略号。确认账户归属与授权范围后自行提交。' },
]);

export function guideVtt() {
  const stamp = seconds => `00:${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}.000`;
  return 'WEBVTT\n\n' + KEY_GUIDE_STEPS.map((step, index) => `${index + 1}\n${stamp(step.start)} --> ${stamp(step.end)}\n${step.title}\n${step.text}\n`).join('\n');
}
