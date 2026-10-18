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

test('feed separates today and all-time passed totals while respecting public consent', t => {
 const f=fixture(t);
 const old=f.service.createSessionOrder({code:CODE+'old',agree:true,showPublic:true});
 f.service.decide(old.id,'passed','Synthetic previous-day result');
 const dayStart=Math.floor((Date.now()+8*3600000)/86400000)*86400000-8*3600000;
 f.store.run('update orders set decided_at = ? where id = ?',dayStart-1000,old.id);
 for (const [suffix,showPublic] of [['public',true],['private',false]]) {
   const o=f.service.createSessionOrder({code:CODE+suffix,agree:true,showPublic});
   f.service.decide(o.id,'passed','Synthetic current-day result');
 }
 const failed=f.service.createSessionOrder({code:CODE+'failed',agree:true,showPublic:true});
 f.service.decide(failed.id,'failed','Synthetic failure');
 const feed=f.service.feed();
 assert.equal(feed.today.passed,2);assert.equal(feed.totalPassed,3);
 assert.equal(feed.today.processed,3);assert.equal(feed.items.length,2);
 assert.ok(feed.items.every(row=>/^sk••••/.test(row.code)));
 assert.ok(!JSON.stringify(feed).includes(CODE));
});


test('12-hour review window updates active legacy deadlines once without deciding or changing completed history', async t => {
 const f=fixture(t),hour=3600000,start=Date.now()-13*hour;
 const active=f.service.createSessionOrder({code:CODE+'active',agree:true});
 const done=f.service.createSessionOrder({code:CODE+'done',agree:true});
 f.service.decide(done.id,'passed','Synthetic completed review');
 for (const id of [active.id,done.id]) f.store.run('update orders set paid_at = ?, due_at = ? where id = ?',start,start+24*hour,id);
 const service=createService({...f,now:()=>start+13*hour});
 assert.equal((await service.lookup(active.id)).dueAt,start+12*hour);
 assert.equal((await service.lookup(done.id)).dueAt,start+24*hour);
 assert.equal(service.stats().overdue,1);
 await service.tick();
 assert.equal((await service.lookup(active.id)).status,'reviewing');
 assert.equal(f.store.get("select count(*) as n from events where kind = 'review_window_updated'").n,1);
 createService({...f,now:()=>start+14*hour});
 assert.equal(f.store.get("select count(*) as n from events where kind = 'review_window_updated'").n,1);
 const next=service.createSessionOrder({code:CODE+'new',agree:true});
 assert.equal(next.dueAt-next.paidAt,12*hour);
});

test('authenticated admin reviews submissions and private queries receive both results and explanations', async t => {
 const f=fixture(t),server=createServer(createApp(f));await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(()=>new Promise(r=>server.close(r)));
 const base=`http://127.0.0.1:${server.address().port}/api/verify/`;
 const post=(path,body,headers={})=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
 assert.equal((await(await fetch(base+'config')).json()).reviewHours,12);
 const created=await(await post('orders',{code:CODE,agree:true})).json();
 assert.equal((await fetch(base+'admin/orders')).status,401);
 assert.equal((await fetch(base+'admin/orders/'+created.id)).status,401);
 assert.equal((await post('admin/login',{password:'wrong-password'})).status,401);
 const login=await post('admin/login',{password:'synthetic-password-only'});
 assert.equal(login.status,200);assert.match(login.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Strict/);
 const Cookie=login.headers.get('set-cookie').split(';')[0],headers={Cookie,'X-GetToken-Admin':'1'};
 const listing=await(await fetch(base+'admin/orders?status=reviewing&q='+created.id,{headers})).json();
 assert.equal(listing.items.length,1);assert.ok(!JSON.stringify(listing).includes(CODE));
 assert.equal((await(await fetch(base+'admin/orders/'+created.id,{headers})).json()).code,CODE);
 const decision='admin/orders/'+created.id+'/decision';
 assert.equal((await post(decision,{result:'passed',reason:'Synthetic complete'},{Cookie})).status,403);
 assert.equal((await post(decision,{result:'passed',reason:''},headers)).status,400);
 assert.equal((await post(decision,{result:'passed',reason:'Accidental paste '+CODE},headers)).status,400);
 assert.equal((await post(decision,{result:'passed',reason:'x'.repeat(310)+CODE},headers)).status,400);
 assert.ok(!JSON.stringify(f.store.all('select detail from events')).includes(CODE));
 const passed=await post(decision,{result:'passed',reason:'Synthetic delivery verified'},headers);
 assert.equal(passed.status,200);assert.equal((await passed.json()).status,'passed');
 assert.equal((await post(decision,{result:'failed',reason:'stale decision'},headers)).status,409);
 const query=await(await fetch(base+'orders/'+created.id,{headers:{'X-GetToken-Order-Access':created.accessToken}})).json();
 assert.equal(query.reason,'Synthetic delivery verified');assert.equal(query.status,'passed');
 assert.ok(!JSON.stringify(query).includes(CODE));
 const second=await(await post('orders',{code:CODE+'second',agree:true})).json();
 assert.equal((await post('admin/orders/'+second.id+'/decision',{result:'failed',reason:'Synthetic session expired'},headers)).status,200);
 const failed=await(await fetch(base+'orders/'+second.id,{headers:{'X-GetToken-Order-Access':second.accessToken}})).json();
 assert.equal(failed.status,'failed');assert.equal(failed.reason,'Synthetic session expired');assert.equal(failed.refund,null);
 await post('admin/logout',{},headers);
 assert.equal((await fetch(base+'admin/orders',{headers})).status,401);
});
