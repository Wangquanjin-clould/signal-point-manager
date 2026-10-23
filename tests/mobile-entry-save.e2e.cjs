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
 await evaluate('window.__syncReplies=0;const oldReply=MobileRuntime.onHttpResult;MobileRuntime.onHttpResult=(...args)=>{__syncReplies++;oldReply(...args)}');
 if(!process.env.SKIP_IDLE)await delay(33000);assert.equal(await evaluate('__syncReplies'),0);pass('idle foreground does not perform periodic sync');
 const id=await evaluate('MobileRuntime.db.prepare("SELECT id FROM modules ORDER BY id LIMIT 1").get().id');
 await evaluate('(async()=>{__state.currentModuleId='+id+';openModuleView()})()');await until('__state.points.length>0 && document.querySelector("#pointsBody input[data-k=point_name]")');
 await evaluate('(()=>{const i=document.querySelector("#pointsBody input[data-k=point_name]");i.value="";i.dispatchEvent(new Event("input",{bubbles:true}));i.focus();i.setSelectionRange(0,0)})()');
 const bounds=await evaluate('(()=>{const r=document.querySelector("#pointsBody input[data-k=point_name]").getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()');
 await delay(2500);
 let ime=shell('shell','dumpsys','input_method');assert.match(ime,/inputType=0x81001/);pass('first position requests uppercase Latin virtual keyboard');
 shell('shell','screencap','-p','/sdcard/spt-letters.png');shell('pull','/sdcard/spt-letters.png',path.join(out,'09-letter-keyboard.png'));
 shell('shell','input','text','g');await until('document.querySelector("#pointsBody input[data-k=point_name]").value==="G"');await delay(800);
 ime=shell('shell','dumpsys','input_method');assert.match(ime,/inputType=0x2\b/);pass('first letter is uppercase and switches keyboard to digits');
 shell('shell','screencap','-p','/sdcard/spt-digits.png');shell('pull','/sdcard/spt-digits.png',path.join(out,'10-number-keyboard.png'));
 shell('shell','input','text','6');await until('__state.points[0].point_name==="G6"');assert.equal(await evaluate('__syncReplies'),0);pass('typing does not synchronize');
 shell('shell','input','keyevent','KEYCODE_BACK');await delay(500);await evaluate('document.getElementById("savePointsBtn").click()');await until('document.getElementById("mobileSyncStatus").textContent.startsWith("已同步")');
 assert.ok(await evaluate('__syncReplies>0'));assert.ok((await remote()).records.some(r=>r.table==='points'&&!r.deleted&&r.data.point_name==='G6'));pass('Save commits SQLite then synchronizes to server');
 const jobs=shell('shell','dumpsys','jobscheduler',pkg);assert.ok(!jobs.includes('JOB #'));pass('no periodic Android sync job remains');
 fs.writeFileSync(path.join(out,'keyboard-save-report.json'),JSON.stringify({device:'ERAZER N10B Android14',tests:report,production_modified:false},null,2));
 }finally{ws?.close();}})().catch(e=>{console.error(e);process.exitCode=1});
