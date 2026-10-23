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
(async()=>{
 try{
  await connect();await until('NativeStore.initialized() && window.__state?.tree.length>0');
  const initial=await remote();const localCount=await evaluate("MobileRuntime.db.prepare('SELECT COUNT(*) n FROM points').get().n");
  assert.equal(localCount,initial.records.filter(r=>r.table==='points'&&!r.deleted).length);
  assert.equal(await evaluate("MobileRuntime.db.prepare('SELECT COUNT(*) n FROM users').get().n"),0);
  pass('first run downloads complete business database without server credentials',{points:localCount});await shot('01-first-download');
  const cfg=await evaluate("fetch('/api/config').then(r=>r.json())");const project=cfg.projects[0],cabinet=cfg.cabinets[0],model=cfg.module_models.find(m=>m.module_type_name==='DI')||cfg.module_models[0];
  shell('shell','cmd','connectivity','airplane-mode','enable');shell('shell','svc','wifi','disable');shell('shell','svc','data','disable');if(real)shell('reverse','--remove','tcp:8793');await delay(1200);
  await evaluate('MobileRuntime.sync()');await until("document.getElementById('mobileSyncStatus').textContent.includes('离线可用')");
  pass('airplane mode native network failure keeps offline app available');
  const no=String(Date.now()).slice(-8);
  const mod=await local('/api/modules',{project_id:project.id,cabinet_id:cabinet.id,module_type_id:model.module_type_id,module_model_id:model.id,module_no:no,note:'模拟器离线新建'});
  assert.equal(mod.status,200,JSON.stringify(mod));
  await evaluate(`(async()=>{await loadTree();__state.currentModuleId=${mod.id};__state.currentProjectId=${project.id};openModuleView();})()`);
  await until(`__state.points.length>0 && __state.points[0].module_id===${mod.id}`);
  const first=await evaluate('__state.points[0]');
  await evaluate("(()=>{const i=document.querySelector('#pointsBody input[data-k=point_name]');i.value='g6';i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new Event('change',{bubbles:true}));document.getElementById('savePointsBtn').click();})()");
  await until('!__state.pointsDirty');assert.equal((await row('points',first.id)).point_name,'G6');
  pass('offline module creation, channel generation, UI editing uppercase and whole-module Save');await shot('02-offline-point-edit');
  const unsentProject=await evaluate("(()=>{const r=MobileRuntime.db.prepare(\"INSERT INTO projects(name,sort_order) VALUES(?,0)\").run('手机离线项目-'+Date.now());return Number(r.lastInsertRowid);})()");
  assert.ok(unsentProject);
  ws.close();shell('shell','am',real?'stop-app':'force-stop',pkg);await delay(1500);shell('shell','am','start','-n',pkg+'/com.engineerservice.points.MainActivity');await delay(1800);await connect();await until('NativeStore.initialized() && window.__state?.tree.length>0');
  assert.equal((await row('points',first.id)).point_name,'G6');pass('process stop and restart in airplane mode retains private SQLite data');
  // The server also gains a different project: equal counts must still merge both records.
  const serverUuid=require('node:crypto').randomBytes(16).toString('hex');
  await remote([{uuid:serverUuid,table:'projects',updated_at:Date.now(),deleted:false,data:{name:'VPS同时新增-'+Date.now(),sort_order:0},refs:{}}]);
  const target=initial.records.find(r=>r.table==='points'&&!r.deleted),latest=structuredClone(target);
  const phoneId=await evaluate(`MobileRuntime.db.prepare('SELECT row_id FROM mobile_sync_records WHERE uuid=?').get('${target.uuid}').row_id`);
  await evaluate(`MobileRuntime.db.prepare('UPDATE points SET point_name=? WHERE id=?').run('G11',${phoneId})`);
  const stamp=await evaluate(`MobileRuntime.db.prepare('SELECT updated_at FROM mobile_sync_records WHERE uuid=?').get('${target.uuid}').updated_at`);
  latest.data.point_name='P1032';latest.updated_at=stamp+100;await remote([latest]);
  if(real)shell('reverse','tcp:8793','tcp:8793');shell('shell','cmd','connectivity','airplane-mode','disable');shell('shell','svc','wifi','enable');shell('shell','svc','data','enable');await delay(2500);await evaluate('MobileRuntime.sync()');
  await until("document.getElementById('mobileSyncStatus').textContent.startsWith('已同步')",60000);
  let after=await remote();assert.equal((await row('points',phoneId)).point_name,'P1032');
  assert.ok(after.records.some(r=>r.table==='points'&&!r.deleted&&r.data.point_name==='G6'));
  assert.ok(await evaluate(`MobileRuntime.db.prepare('SELECT row_id FROM mobile_sync_records WHERE uuid=? AND deleted=0').get('${serverUuid}')!=null`));
  assert.ok(after.records.some(r=>r.table==='projects'&&r.data.name?.startsWith('手机离线项目-')));
  pass('reconnect uploads offline module and downloads VPS-only rows even with equal project counts');pass('same UUID conflict chooses newest VPS timestamp');
  // Now phone is newer than a pending VPS edit.
  const change=structuredClone(after.records.find(r=>r.uuid===target.uuid));change.updated_at+=100;change.data.point_name='P1000';await remote([change]);
  await evaluate(`MobileRuntime.db.prepare('UPDATE points SET point_name=? WHERE id=?').run('G12',${phoneId});MobileRuntime.db.prepare('UPDATE mobile_sync_records SET updated_at=? WHERE uuid=?').run(${change.updated_at+100},'${target.uuid}');MobileRuntime.sync()`);
  await until("document.getElementById('mobileSyncStatus').textContent.startsWith('已同步')");after=await remote();assert.equal(after.records.find(r=>r.uuid===target.uuid).data.point_name,'G12');pass('same UUID conflict chooses newest phone timestamp');
  const beforeCount=after.records.length;await evaluate('MobileRuntime.sync()');await until("document.getElementById('mobileSyncStatus').textContent.startsWith('已同步')");assert.equal((await remote()).records.length,beforeCount);pass('repeated sync is idempotent and creates no duplicate records');
  await evaluate(`(async()=>{await loadTree();__state.currentModuleId=${mod.id};__state.currentProjectId=${project.id};openModuleView();})()`);
  await until(`__state.points.length>0 && __state.points[0].module_id===${mod.id}`);
  const csv=await evaluate(`fetch('/api/export?module_id=${mod.id}').then(async r=>({ok:r.ok,text:new TextDecoder().decode(r.bytes)}))`);
  assert.ok(csv.ok&&csv.text.includes('G6'));pass('offline-capable module CSV export keeps edited point data');
  const workbook=await evaluate(`fetch('/api/export?project_id=${project.id}').then(async r=>({ok:r.ok,signature:Array.from(r.bytes.slice(0,4)),text:new TextDecoder().decode(r.bytes)}))`);
  assert.ok(workbook.ok);assert.deepEqual(workbook.signature,[80,75,3,4]);assert.ok(workbook.text.includes('sheet1.xml')&&workbook.text.includes('sheet2.xml'));pass('project export generates DI and DO Excel worksheets locally');
  if(!real){shell('shell','wm','user-rotation','lock','0');shell('shell','wm','density','160');shell('shell','wm','size','390x844');await until('innerWidth<=400');
  assert.equal(await evaluate("getComputedStyle(document.getElementById('pointsTable')).display"),'table');
  assert.ok(await evaluate("(()=>{const t=document.getElementById('tableWrap');t.scrollLeft=200;return t.scrollLeft>0})()"));await shot('04-phone-width');pass('390px phone layout preserves one horizontally scrollable point table');shell('shell','wm','size','reset');}else{assert.equal(await evaluate("getComputedStyle(document.getElementById('pointsTable')).display"),'table');await shot('04-tablet-table');pass('real tablet retains unified point table');}
  await local('/api/modules/'+mod.id,{},'DELETE');await evaluate('MobileRuntime.sync()');await until("document.getElementById('mobileSyncStatus').textContent.startsWith('已同步')");
  after=await remote();assert.ok(!after.records.some(r=>r.table==='modules'&&!r.deleted&&r.data.module_no===no));pass('module deletion and cascading point tombstones synchronize without resurrection');
  await shot('03-after-reconnect');
  const bgName='后台任务验证-'+Date.now();
  await evaluate(`MobileRuntime.db.prepare('INSERT INTO projects(name,sort_order) VALUES(?,0)').run('${bgName}')`);
  shell('shell','input','keyevent','KEYCODE_HOME');await delay(1000);
  shell('shell','cmd','jobscheduler','run','-f',pkg,'901');
  let bgFound=false;for(let i=0;i<45;i++){if((await remote()).records.some(r=>r.table==='projects'&&r.data.name===bgName)){bgFound=true;break;}await delay(1000);}
  assert.ok(bgFound,'OS background job did not upload local row');pass('Android JobScheduler syncs SQLite while activity is in background');
  fs.writeFileSync(path.join(out,'simulation-report.json'),JSON.stringify({android:real?'ERAZER N10B Android 14 real tablet':'35 x86_64 emulator',tested_at:new Date().toISOString(),production_modified:false,tests:report},null,2));
 } finally {if(!real){shell('shell','wm','size','reset');shell('shell','wm','density','reset');shell('shell','wm','user-rotation','free');}else{shell('reverse','tcp:8793','tcp:8793');}shell('shell','cmd','connectivity','airplane-mode','disable');shell('shell','svc','wifi','enable');shell('shell','svc','data','enable');ws?.close();}
})().catch(e=>{console.error(e);fs.writeFileSync(path.join(out,'simulation-failure.json'),JSON.stringify({tests:report,error:e.stack},null,2));process.exitCode=1;});
