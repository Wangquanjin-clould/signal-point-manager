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

async function touch(selector){shell('shell','input','keyevent','KEYCODE_WAKEUP');const point=await evaluate('(()=>{const r=document.querySelector('+JSON.stringify(selector)+').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()');await cdp('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});await cdp('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await delay(250);}
async function checkFloating(){const r=await evaluate('(()=>{const p=document.getElementById("pointKeyboard").getBoundingClientRect(),i=document.activeElement.getBoundingClientRect();return{separate:p.top>=i.bottom||p.bottom<=i.top,gap:Math.min(Math.abs(p.top-i.bottom),Math.abs(p.bottom-i.top)),inside:p.left>=0&&p.right<=innerWidth&&p.top>=0&&p.bottom<=innerHeight&&i.top>=document.querySelector(".topbar").getBoundingClientRect().bottom&&i.bottom<=innerHeight}})()');assert.ok(r.separate&&r.inside&&r.gap<=8,JSON.stringify(r));}

let originalStayOn='';
(async()=>{try{
 originalStayOn=shell('shell','settings','get','global','stay_on_while_plugged_in').trim();shell('shell','svc','power','stayon','usb');shell('shell','input','keyevent','KEYCODE_WAKEUP');shell('shell','input','swipe','640','700','640','200','300');shell('shell','am','start','-n',pkg+'/com.engineerservice.points.MainActivity');
 await connect();await until('NativeStore.initialized() && window.__state?.tree.length>0');
 const original=await evaluate('JSON.stringify(MobileSync.snapshot(MobileRuntime.db))');
 for(const lang of ['en','ar-EG','zh-CN','ar-EG']){await touch('[data-language="'+lang+'"]');await until('document.documentElement.lang==='+JSON.stringify(lang));assert.equal(await evaluate('document.documentElement.dir'),lang==='ar-EG'?'rtl':'ltr');}
 pass('all three flag buttons switch language on Nexus7');
 const id=await evaluate('MobileRuntime.db.prepare("SELECT id FROM modules ORDER BY id LIMIT 1").get().id');await evaluate('(()=>{__state.currentModuleId='+id+';openModuleView()})()');await until('__state.points.length>1');
 await touch('#pointsBody input[data-k=point_name]');await until('!document.getElementById("pointKeyboard").hidden');
 assert.equal(await evaluate('getComputedStyle(document.querySelector(".point-keyboard-combined-grid")).direction'),'ltr');assert.equal(await evaluate('document.querySelector("#pointKeyboard [data-action=next]").textContent'),'الصف التالي');
 assert.ok(!/mInputShown=true/.test(shell('shell','dumpsys','input_method')));await checkFloating();pass('Arabic keyboard keeps Latin number/letter order and avoids the input');
 shell('shell','screencap','-p','/sdcard/spt-i18n.png');shell('pull','/sdcard/spt-i18n.png',path.join(out,'arabic-keyboard-nexus7.png'));
 await touch('#pointKeyboard [data-action=done]');
 assert.equal(await evaluate('JSON.stringify(MobileSync.snapshot(MobileRuntime.db))'),original);pass('language switching does not change the local database');
 await evaluate('NativeStore.openSyncSettings()');await delay(1000);shell('shell','uiautomator','dump','/sdcard/spt-locale.xml');const xml=shell('shell','cat','/sdcard/spt-locale.xml');assert.ok(xml.includes('التحميل الأول / إعدادات المزامنة'));assert.ok(xml.includes('حفظ ومزامنة'));shell('shell','input','keyevent','KEYCODE_BACK');pass('native sync settings use the selected Arabic language');
 await evaluate('location.reload()');await until('NativeStore.initialized() && document.documentElement.lang==="ar-EG" && window.__state?.tree.length>0');assert.equal(await evaluate('document.querySelector("[data-language=ar-EG]").getAttribute("aria-pressed")'),'true');pass('language choice survives an app page restart');
 fs.writeFileSync(path.join(out,'i18n-report.json'),JSON.stringify({device:'Nexus7 Android7.1.2',tests:report,production_modified:false},null,2));
 }finally{if(/^\d+$/.test(originalStayOn))shell('shell','settings','put','global','stay_on_while_plugged_in',originalStayOn);ws?.close();}})().catch(e=>{console.error(e);process.exitCode=1});
