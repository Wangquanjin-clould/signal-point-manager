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

(async()=>{let original='';try{
 original=shell('shell','settings','get','global','stay_on_while_plugged_in').trim();shell('shell','svc','power','stayon','usb');shell('shell','input','keyevent','KEYCODE_WAKEUP');shell('shell','input','swipe','640','700','640','200','300');shell('shell','am','start','-n',pkg+'/com.engineerservice.points.MainActivity');
 await connect();await until('NativeStore.initialized() && window.__state?.tree.length>0');
 const chosen=await evaluate('(()=>{const p=__state.tree.find(p=>p.cabinets.some(c=>c.modules.length)),c=p.cabinets.find(c=>c.modules.length);return{project:p.id,cabinet:c.id,count:c.modules.reduce((n,m)=>n+m.point_count,0)}})()');
 await evaluate('selectCabinet('+chosen.project+','+chosen.cabinet+')');await until('document.querySelectorAll("#cabinetChannelsBody tr").length==='+chosen.count);
 assert.ok(await evaluate('(()=>{const a=document.getElementById("moduleCards").getBoundingClientRect(),b=document.getElementById("cabinetChannels").getBoundingClientRect();return b.top>=a.bottom})()'));pass('Nexus7 all cabinet channels appear below module table',{channels:chosen.count});
 shell('reverse','--remove','tcp:8793');await evaluate('renderOverview()');await until('document.querySelectorAll("#cabinetChannelsBody tr").length==='+chosen.count);assert.equal(await evaluate('getComputedStyle(document.querySelector("#cabinetChannelsBody tr")).display'),'table-row');assert.ok(await evaluate('(()=>{const w=document.querySelector(".cabinet-channel-wrap");return w.scrollWidth>w.clientWidth})()'));pass('Nexus7 reads complete channel table offline with horizontal scrolling');
 await evaluate('document.getElementById("cabinetChannels").scrollIntoView({block:"start"})');await shot('cabinet-channels-nexus7');
 await evaluate('selectProject('+chosen.project+')');assert.equal(await evaluate('document.getElementById("cabinetChannels").hidden'),true);pass('project overview hides cabinet-only channel table');
 fs.writeFileSync(path.join(out,'cabinet-channels-report.json'),JSON.stringify({device:'Nexus7 Android7.1.2',tests:report,production_modified:false},null,2));
 }finally{if(/^\d+$/.test(original))shell('shell','settings','put','global','stay_on_while_plugged_in',original);shell('reverse','tcp:8793','tcp:8793');ws?.close();}})().catch(e=>{console.error(e);process.exitCode=1});
