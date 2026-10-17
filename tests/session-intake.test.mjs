import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { openStore } from '../server/verify/store.mjs';
import { loadConfig } from '../server/verify/config.mjs';
import { createService } from '../server/verify/service.mjs';
import { createApp } from '../server/verify/app.mjs';
import { hashPassword } from '../server/verify/secure.mjs';
const CODE = 'sk-ant-sid01-' + 'synthetic'.repeat(25);
function fixture(t) {
  const store = openStore(':memory:');t.after(()=>store.close());
  const config=loadConfig({VERIFY_SECRET:randomBytes(32).toString('hex')}),providers={};
  store.setSetting('admin_password', hashPassword('synthetic-password-only'));
  const service=createService({store,config,providers});
  return {store,config,providers,service};
}
test('Session Key alone enters processing; duplicates are private, failures create no refunds',async t=>{
 const f=fixture(t),o=f.service.createSessionOrder({code:CODE,agree:true});
 assert.equal(o.status,'reviewing');assert.equal(o.external.source,'session');assert.equal(o.external.reference,undefined);
 assert.equal(o.fees,null);assert.equal(o.payment,undefined);assert.ok(!JSON.stringify(o).includes(CODE));
 assert.equal(f.service.adminDetail(o.id).code,CODE);
 assert.throws(()=>f.service.createSessionOrder({code:CODE,agree:true}),e=>e.status===409&&!e.message.includes(o.id)&&!e.message.includes(o.accessToken));
 assert.throws(()=>f.service.decide(o.id,'passed'),/证据摘要/);
 f.service.decide(o.id,'failed','Synthetic unsuccessful processing');await f.service.tick();
 assert.equal((await f.service.lookup(o.id)).refund,null);
 assert.equal(f.store.get('select count(*) as n from refunds').n,0);
 assert.equal(f.store.get('select count(*) as n from payments').n,0);
 const next=f.service.createSessionOrder({code:CODE,agree:true});
 f.service.decide(next.id,'passed','Synthetic completed processing');
 assert.equal((await f.service.lookup(next.id)).reason,'Synthetic completed processing');
});
test('key-only HTTP rejects purchase fields and keeps private lookup authorization',async t=>{
 const f=fixture(t),server=createServer(createApp(f));await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(()=>new Promise(r=>server.close(r)));
 const base=`http://127.0.0.1:${server.address().port}/api/verify/`;
 const post=body=>fetch(base+'orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const cfg=await(await fetch(base+'config')).json();assert.equal(cfg.submissionMode,'session-key');assert.deepEqual(cfg.channels,[]);
 assert.equal((await post({code:CODE,agree:true,reference:'1234567890123456789',source:'taobao'})).status,400);
 assert.equal((await post({code:CODE,agree:false})).status,400);
 const created=await post({code:CODE,agree:true});assert.equal(created.status,201);const o=await created.json();
 assert.equal(o.status,'reviewing');assert.equal((await fetch(base+'orders/'+o.id)).status,403);
 const view=await(await fetch(base+'orders/'+o.id,{headers:{'X-GetToken-Order-Access':o.accessToken}})).json();
 assert.equal(view.id,o.id);assert.equal(view.accessToken,undefined);assert.ok(!JSON.stringify(view).includes(CODE));
 assert.equal((await post({code:CODE,agree:true})).status,409);
});
test('paused intake never stores Session Keys',t=>{
 const f=fixture(t),service=createService({...f,config:{...f.config,acceptExternalOrders:false}});
 assert.throws(()=>service.createSessionOrder({code:CODE,agree:true}),e=>e.status===503);
 assert.equal(f.store.get('select count(*) as n from orders').n,0);
});
