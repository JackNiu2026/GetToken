#!/usr/bin/env node
// Server-side admin tool, installed as `gettoken-verify`:
//   gettoken-verify passwd   set or change the admin page password (asks twice, input hidden)
//   gettoken-verify status | doctor | reconcile ORDER | decision ORDER passed/failed [REASON]
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { serviceContractReady } from '../../assets/gettoken/verify-rules.mjs';
import { loadConfig } from './config.mjs';
import { openStore } from './store.mjs';
import { createProviders } from './pay/index.mjs';
import { hashPassword } from './secure.mjs';
import { createService } from './service.mjs';

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
} else if (command === 'status' || command === 'doctor') {
  const providers = createProviders(config);
  const service = createService({ store, config, providers });
  const counts = store.all('select status, count(*) as n from orders group by status');
  console.log(`付款模式：${config.mode}`);
  console.log(`可用付款方式：${Object.values(providers).map(p => p.label).join('、') || '无'}`);
  console.log(`后台密码：${store.setting('admin_password') ? '已设置' : '未设置（运行 gettoken-verify passwd）'}`);
  console.log(`新订单：${service.acceptingNewOrders() ? '开放' : '关闭（历史款项和退款继续处理）'}`);
  console.log(`订单：${counts.map(c => `${c.status} ${c.n}`).join('，') || '0'}`);
  const pending = store.get("select count(*) as n from refunds where status != 'success'").n;
  console.log(`未完成退款：${pending}`);
  if (command === 'doctor') {
    const ready = config.mode === 'live' && providers.alipay && providers.wechat && store.setting('admin_password') && serviceContractReady(config.serviceContract);
    console.log(`服务交付及支持信息：${serviceContractReady(config.serviceContract) ? '已确认' : '不完整，禁止开放'}`);
    console.log(`双渠道本地配置检查：${ready ? '通过' : '未通过（需要 live、两个商户与后台密码）'}`);
    console.log('此检查验证密钥格式与证书配对；平台签约、密钥绑定和真实到账需扫码验收。');
    process.exitCode = ready ? 0 : 1;
  }
} else if (command === 'reconcile' || command === 'decision') {
  const providers = createProviders(config);
  const service = createService({ store, config, providers, log: message => console.error(message) });
  const id = process.argv[3];
  try {
    if (!id) throw new Error('Missing order id');
    if (command === 'decision') service.decide(id, process.argv[4], process.argv.slice(5).join(' '), 'cli');
    await service.lookup(id);
    for (const refund of store.all("select * from refunds where order_id = ? and status != 'success'", id)) await service.runRefund(refund, 'cli');
    console.log(JSON.stringify(await service.lookup(id), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
} else {
  console.log('用法：gettoken-verify passwd | status | doctor | reconcile ORDER_ID | decision ORDER_ID passed/failed [REASON]');
  process.exitCode = command ? 1 : 0;
}
rl.close();
store.close();
