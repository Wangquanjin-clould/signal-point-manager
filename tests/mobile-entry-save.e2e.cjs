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
 let pid='';for(let i=0;i<60&&!pid;i++){try{pid=shell('shell','pidof',pkg).trim().split(/\s+/)[0];}catch{}if(!pid)await delay(200);}if(!pid)throw Error('App process unavailable');shell('forward','tcp:9226','localabstract:webview_devtools_remote_'+pid);
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

async function touch(selector){const point=await evaluate('(()=>{const r=document.querySelector('+JSON.stringify(selector)+').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()');await cdp('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});await cdp('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await delay(250);}
(async()=>{try{
 await connect();await until('NativeStore.initialized() && window.__state?.tree.length>0');
 const id=await evaluate('MobileRuntime.db.prepare("SELECT id FROM modules ORDER BY id LIMIT 1").get().id');await evaluate('(async()=>{__state.currentModuleId='+id+';openModuleView()})()');await until('__state.points.length>1');
 await evaluate('(()=>{const i=document.querySelector("#pointsBody input[data-k=point_name]");i.value="";i.dispatchEvent(new Event("input",{bubbles:true}));i.scrollIntoView({block:"center"});window.__syncReplies=0;const old=MobileRuntime.onHttpResult;MobileRuntime.onHttpResult=(...args)=>{__syncReplies++;old(...args)}})()');
 await touch('#pointsBody input[data-k=point_name]');await until('!document.getElementById("pointKeyboard").hidden');
 assert.equal(await evaluate('document.querySelector("#pointsBody input[data-k=point_name]").readOnly'),true);assert.ok(await evaluate('!!document.querySelector("#pointKeyboard [data-key=G]")'));
 assert.ok(!/mInputShown=true/.test(shell('shell','dumpsys','input_method')));assert.ok(await evaluate('document.getElementById("pointKeyboard").offsetHeight<innerHeight*0.3'));pass('compact uppercase in-app keyboard opens without system IME');
 shell('shell','screencap','-p','/sdcard/spt-built-in.png');shell('pull','/sdcard/spt-built-in.png',path.join(out,'in-app-letter-keyboard.png'));
 await touch('#pointKeyboard [data-key=G]');await until('__state.points[0].point_name==="G"');assert.ok(await evaluate('!!document.querySelector("#pointKeyboard [data-key="+JSON.stringify("6")+"]")'));await touch('#pointKeyboard [data-key="6"]');await until('__state.points[0].point_name==="G6"');pass('letter input switches to compact digits and updates draft');
 await touch('#pointKeyboard [data-action=backspace]');assert.equal(await evaluate('__state.points[0].point_name'),'G');await touch('#pointKeyboard [data-action=clear]');assert.equal(await evaluate('__state.points[0].point_name'),'');assert.ok(await evaluate('!!document.querySelector("#pointKeyboard [data-key=G]")'));pass('backspace and clear restore letter entry');
 await touch('#pointKeyboard [data-key=G]');await touch('#pointKeyboard [data-key="6"]');
 shell('shell','screencap','-p','/sdcard/spt-built-in.png');shell('pull','/sdcard/spt-built-in.png',path.join(out,'in-app-number-keyboard.png'));
 await touch('#pointKeyboard [data-action=next]');assert.equal(await evaluate('Number(document.activeElement.closest("tr").dataset.id)'),await evaluate('__state.points[1].id'));pass('Next row advances within point table');
 await touch('#pointKeyboard [data-action=done]');assert.equal(await evaluate('document.getElementById("pointKeyboard").hidden'),true);assert.equal(await evaluate('__syncReplies'),0);pass('closing keyboard leaves unsaved data local');
 await evaluate('document.getElementById("savePointsBtn").click()');await until('document.getElementById("mobileSyncStatus").textContent.startsWith("已同步")');assert.ok(await evaluate('__syncReplies>0'));pass('Save retains existing SQLite and synchronization behavior');
 await evaluate('document.getElementById("treeFilter").scrollIntoView()');await touch('#treeFilter');await delay(1200);assert.ok(/mInputShown=true/.test(shell('shell','dumpsys','input_method')));pass('ordinary search fields still support the system keyboard');shell('shell','input','keyevent','KEYCODE_BACK');
 fs.writeFileSync(path.join(out,'in-app-keyboard-report.json'),JSON.stringify({device:process.env.ANDROID_DEVICE_LABEL||'Nexus7',tests:report,production_modified:false},null,2));
 }finally{ws?.close();}})().catch(e=>{console.error(e);process.exitCode=1});
