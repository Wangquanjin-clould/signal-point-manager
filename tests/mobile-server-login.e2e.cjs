'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const adb=process.env.ADB_BIN||'C:/Users/wangquanjin/AppData/Local/Android/Sdk/platform-tools/adb.exe';
const real=!!process.env.REAL_DEVICE, pkg=process.env.MOBILE_TEST_PACKAGE||'com.engineerservice.points',base='http://127.0.0.1:8793',token='simulation-only-token-with-32-characters';
const out=path.resolve('mobile-test-results');fs.mkdirSync(out,{recursive:true});
const report=[];const pass=(name,details={})=>{report.push({name,passed:true,...details});console.log('PASS',name);};
const shell=(...args)=>execFileSync(adb,['-s',process.env.ANDROID_SERIAL||'emulator-5554',...args],{encoding:'utf8',timeout:20000});
const delay=ms=>new Promise(r=>setTimeout(r,ms));
let ws,seq=0,waiters=new Map();
async function connect(){
 let pid='';for(let i=0;i<60&&!pid;i++){try{pid=shell('shell','pidof',pkg).trim();}catch{}if(!pid)await delay(200);}if(!pid)throw Error('App process unavailable');shell('forward','tcp:9226','localabstract:webview_devtools_remote_'+pid);
 for(let i=0;i<60;i++){try{const all=await(await fetch('http://127.0.0.1:9226/json')).json();const list=all.filter(x=>x.url.endsWith('/index.html'));if(list.length){ws=new WebSocket(list[0].webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});ws.onmessage=e=>{const m=JSON.parse(e.data);if(waiters.has(m.id)){waiters.get(m.id)(m);waiters.delete(m.id);}};return;}}catch{}await delay(300);}
 throw Error('WebView unavailable');
}
function cdp(method,params){return new Promise((resolve,reject)=>{const id=++seq;const timer=setTimeout(()=>{waiters.delete(id);reject(Error(method+' timeout'));},60000);waiters.set(id,m=>{clearTimeout(timer);m.error?reject(Error(JSON.stringify(m.error))):resolve(m.result);});ws.send(JSON.stringify({id,method,params}));});}
async function evaluate(expression){const r=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
async function until(expression,timeout=45000){const end=Date.now()+timeout;while(Date.now()<end){try{if(await evaluate(expression))return;}catch{}await delay(400);}throw Error('Wait failed: '+expression);}
const local=(url,body,method='POST')=>evaluate(`fetch(${JSON.stringify(url)},{method:${JSON.stringify(method)},body:${JSON.stringify(JSON.stringify(body))}}).then(async r=>({status:r.status,...await r.json()}))`);
async function remote(records){const r=await fetch(base+'/api/mobile/sync',{method:records?'POST':'GET',headers:{'X-Mobile-Sync-Token':token,'Content-Type':'application/json'},body:records?JSON.stringify({version:1,records}):undefined});const j=await r.json();assert.equal(r.status,200,JSON.stringify(j));return j;}
const row=(table,id)=>evaluate(`MobileRuntime.db.prepare('SELECT * FROM ${table} WHERE id=?').get(${id})`);
async function shot(name){const r=await cdp('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(out,name+'.png'),Buffer.from(r.data,'base64'));}

(async()=>{try{
 await connect();await until('NativeStore.initialized() && window.__state?.tree.length>0');
 let r=await local('/api/auth/login',{username:'admin',password:'admin123'});assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.user.role,'admin');assert.equal(r.user.id,null);assert.ok(r.user.server_id);pass('server administrator account logs into Android without replicating server users');
 assert.equal(await evaluate('MobileRuntime.db.prepare("SELECT COUNT(*) n FROM users").get().n'),0);
 await local('/api/auth/logout',{});r=await local('/api/auth/login',{username:'admin',password:'wrong-password'});assert.equal(r.status,401);pass('online wrong password is rejected even after a cached successful login');
 r=await local('/api/auth/login',{username:'admin',password:'admin123'});assert.equal(r.status,200);
 await local('/api/auth/logout',{});shell('reverse','--remove','tcp:8793');r=await local('/api/auth/login',{username:'admin',password:'admin123'});assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.user.role,'admin');pass('previously verified server account logs in offline');
 await local('/api/auth/logout',{});r=await local('/api/auth/login',{username:'admin',password:'wrong-password'});assert.equal(r.status,401);pass('offline incorrect password is rejected');shell('reverse','tcp:8793','tcp:8793');
 const nativeLogin=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'admin123'})});const cookie=nativeLogin.headers.get('set-cookie').split(';')[0];
 const account='tablet_'+Date.now();const created=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json','Cookie':cookie},body:JSON.stringify({username:account,password:'fixture-only-pass',role:'user'})});assert.equal(created.status,200);
 r=await local('/api/auth/login',{username:account,password:'fixture-only-pass'});assert.equal(r.status,200);assert.equal(r.user.role,'user');
 r=await local('/api/config/parts',{name:'must-not-create'});assert.equal(r.status,403);pass('ordinary server accounts cannot modify administrator configuration');
 r=await local('/api/auth/password',{oldPassword:'fixture-only-pass',newPassword:'fixture-only-updated'});assert.equal(r.status,200,JSON.stringify(r));await local('/api/auth/logout',{});
 r=await local('/api/auth/login',{username:account,password:'fixture-only-updated'});assert.equal(r.status,200);assert.equal(r.user.mustChangePwd,false);pass('server password change uses authenticated server session');
 fs.writeFileSync(path.join(out,'server-login-report.json'),JSON.stringify({device:'ERAZER N10B Android14',tests:report,production_modified:false},null,2));
 }finally{shell('reverse','tcp:8793','tcp:8793');ws?.close();}})().catch(e=>{console.error(e);process.exitCode=1});
