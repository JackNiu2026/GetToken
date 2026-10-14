#!/usr/bin/env node
// Server-side admin tool, installed as `gettoken-verify`:
//   gettoken-verify passwd   set or change the admin page password (asks twice, input hidden)
//   gettoken-verify status   payment mode, configured channels and order counts
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { loadConfig } from './config.mjs';
import { openStore } from './store.mjs';
import { createProviders } from './pay/index.mjs';
import { hashPassword } from './secure.mjs';

// One reader for every question, so piped input (two lines) works as well as a terminal.
const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
let hidden = false;
const write = rl._writeToOutput?.bind(rl);
if (write) rl._writeToOutput = text => { if (!hidden || /[\r\n]/.test(text)) write(text); };
const lines = rl[Symbol.asyncIterator]();
async function ask(prompt) {
  hidden = false;
  process.stdout.write(prompt);
  hidden = true;
  const { value = '' } = await lines.next();
  hidden = false;
  if (process.stdin.isTTY) process.stdout.write('\n');
  return value;
}

const config = loadConfig();
const store = openStore(join(config.dataDir, 'verify.db'));
const command = process.argv[2];

if (command === 'passwd') {
  const first = await ask('新的后台密码（至少 12 位）：');
  if (first.length < 12) { console.error('密码太短，至少 12 位'); process.exit(1); }
  if ((await ask('再输入一次：')) !== first) { console.error('两次输入不一致'); process.exit(1); }
  store.setSetting('admin_password', hashPassword(first));
  store.run('delete from sessions');
  console.log('后台密码已更新，已登录的会话全部退出。');
} else if (command === 'status') {
  const providers = createProviders(config);
  const counts = store.all('select status, count(*) as n from orders group by status');
  console.log(`付款模式：${config.mode}`);
  console.log(`可用付款方式：${Object.values(providers).map(p => p.label).join('、') || '无'}`);
  console.log(`后台密码：${store.setting('admin_password') ? '已设置' : '未设置（运行 gettoken-verify passwd）'}`);
  console.log(`订单：${counts.map(c => `${c.status} ${c.n}`).join('，') || '0'}`);
} else {
  console.log('用法：gettoken-verify passwd | status');
  process.exitCode = command ? 1 : 0;
}
rl.close();
store.close();
