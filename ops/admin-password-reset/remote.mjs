// Plaintext exists only in process memory after OAEP decryption on the server.
import { generateKeyPairSync, privateDecrypt, constants } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { openStore } from '/opt/gettoken/verify/current/server/verify/store.mjs';
import { hashPassword, checkPassword } from '/opt/gettoken/verify/current/server/verify/secure.mjs';
const [mode, dir] = process.argv.slice(2);
if (dir !== '/var/lib/gettoken-ops/20261018-onetime-admin' || process.getuid() !== 0) throw new Error('Invalid maintenance context');
const keyFile=join(dir,'private.pem'), metaFile=join(dir,'request.json'), doneFile=join(dir,'completed.json'), payloadFile=join(dir,'payload.bin');
if (existsSync(doneFile)) {
 if(existsSync(payloadFile))unlinkSync(payloadFile);
 console.log('ADMIN_PASSWORD_RESET_ALREADY_COMPLETED: no password changes made.');
 process.exit(0);
}
if(mode==='prepare') {
 if (!existsSync(keyFile)) {
  const keys=generateKeyPairSync('rsa',{modulusLength:3072});
  writeFileSync(keyFile,keys.privateKey.export({format:'pem',type:'pkcs8'}),{mode:0o600,flag:'wx'});
  writeFileSync(metaFile,JSON.stringify({operation:'20261018-onetime-admin',expiresAt:Date.now()+20*60000}),{mode:0o600,flag:'wx'});
 }
 const {createPublicKey}=await import('node:crypto');
 console.log('BEGIN_ADMIN_RESET_PUBLIC_KEY');
 console.log(createPublicKey(readFileSync(keyFile)).export({format:'pem',type:'spki'}).trim());
 console.log('END_ADMIN_RESET_PUBLIC_KEY');
 process.exit(0);
}
if(mode!=='apply')throw new Error('Invalid maintenance phase');
const meta=JSON.parse(readFileSync(metaFile,'utf8'));
if(Date.now()>meta.expiresAt)throw new Error('Encrypted handoff expired; password not changed');
const payload=JSON.parse(privateDecrypt({key:readFileSync(keyFile),padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},readFileSync(payloadFile)).toString('utf8'));
if(payload.operation!==meta.operation || typeof payload.password!=='string' || !payload.password || payload.password.length>100)throw new Error('Invalid encrypted handoff');
const store=openStore('/var/lib/gettoken-verify/verify.db');
const previous=store.setting('admin_password');
const hash=hashPassword(payload.password);
let cookie;
try {
 store.transaction(()=>{store.setSetting('admin_password',hash);store.run('delete from sessions');});
 if(!checkPassword(payload.password,store.setting('admin_password')))throw new Error('Stored password verification failed');
 const response=await fetch('http://127.0.0.1:8790/api/verify/admin/login',{
  method:'POST',headers:{'Content-Type':'application/json','X-Forwarded-Proto':'https'},
  body:JSON.stringify({password:payload.password}),signal:AbortSignal.timeout(10000),
 });
 if(!response.ok)throw new Error('Admin login acceptance failed');
 cookie=response.headers.get('set-cookie')?.split(';')[0];
 if(!cookie)throw new Error('Admin session was not issued');
 const me=await fetch('http://127.0.0.1:8790/api/verify/admin/me',{headers:{Cookie:cookie},signal:AbortSignal.timeout(10000)});
 if(!me.ok || !(await me.json()).loggedIn)throw new Error('Admin session acceptance failed');
 const logout=await fetch('http://127.0.0.1:8790/api/verify/admin/logout',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json','X-GetToken-Admin':'1'},body:'{}',signal:AbortSignal.timeout(10000)});
 if(!logout.ok)throw new Error('Test session logout failed');
 const after=await fetch('http://127.0.0.1:8790/api/verify/admin/me',{headers:{Cookie:cookie},signal:AbortSignal.timeout(10000)});
 if((await after.json()).loggedIn)throw new Error('Test session still active');
 writeFileSync(doneFile,JSON.stringify({operation:meta.operation,completedAt:Date.now(),loginVerified:true}),{mode:0o600,flag:'wx'});
 unlinkSync(keyFile);unlinkSync(payloadFile);unlinkSync(metaFile);
 console.log('ADMIN_PASSWORD_RESET_VERIFIED: password updated; previous sessions revoked; login and logout verified. No submissions accessed.');
} catch(error) {
 if(store.setting('admin_password')===hash && previous)store.transaction(()=>{store.setSetting('admin_password',previous);store.run('delete from sessions');});
 throw new Error('Admin password maintenance failed; prior password restored when possible.');
} finally {store.close();}
