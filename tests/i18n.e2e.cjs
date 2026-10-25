'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process'),{once}=require('node:events');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const dir=path.resolve('tmp/i18n-ui-'+Date.now());fs.mkdirSync(dir,{recursive:true});
 const app=spawn(process.execPath,['-e',"const s=require('./server');s.on('listening',()=>process.send(s.address().port))"],{env:{...process.env,DATA_DIR:dir,PORT:'0',HOST:'127.0.0.1'},stdio:['ignore','ignore','inherit','ipc']});let browser;
 try{
  const [port]=await once(app,'message');browser=await chromium.launch({channel:'msedge',headless:true});const context=await browser.newContext({baseURL:'http://127.0.0.1:'+port,viewport:{width:1280,height:800}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const cfg=await(await context.request.get('/api/config')).json(),model=cfg.module_models[0],project=cfg.projects[0],cabinet=cfg.cabinets[0];
  const r=await context.request.post('/api/modules',{data:{project_id:project.id,cabinet_id:cabinet.id,module_no:'LANG_TEST',module_type_id:model.module_type_id,module_model_id:model.id}});assert.equal(r.status(),200);const id=(await r.json()).id;
  await page.goto('/');await page.waitForFunction('window.__state?.tree.length>0');
  await page.locator('[data-language=en]').click();await page.waitForFunction('document.querySelector("#overviewTitle").textContent==="Projects"');assert.equal(await page.locator('html').getAttribute('dir'),'ltr');
  await page.locator('[data-language="ar-EG"]').click();await page.waitForFunction('document.documentElement.dir==="rtl"');assert.equal(await page.locator('#overviewTitle').innerText(),'نظرة عامة على المشاريع');
  // Real tree selections and asynchronous renders retain their data and localize new UI.
  await page.evaluate(([p,c])=>selectCabinet(p,c),[project.id,cabinet.id]);await page.waitForFunction('document.querySelectorAll("#cabinetChannelsBody tr").length>0');
  assert.equal(await page.locator('#overviewTitle').innerText(),project.name+' / '+cabinet.name);
  assert.equal(await page.locator('#cabinetChannels th').first().innerText(),'رقم الوحدة');assert.equal(await page.locator('.module-list-row td').first().innerText(),'LANG_TEST');
  await page.evaluate(id=>{__state.currentModuleId=id;openModuleView();},id);await page.waitForFunction('__state.points.length>0');
  await page.locator('#pointsBody input[data-k=point_name]').first().fill('G6');await page.waitForFunction('__state.pointsDirty');
  assert.equal(await page.locator('#pointsBody .cell-seq').first().getAttribute('data-label'),'序号');assert.equal(await page.locator('#pointsBody .cell-seq').first().getAttribute('data-localized-label'),'الرقم');
  const before=await page.evaluate(()=>JSON.stringify(__state.points));
  await page.locator('[data-language=en]').click();await page.waitForFunction('document.querySelector("#savePointsBtn").textContent==="Save"');
  assert.equal(await page.evaluate(()=>JSON.stringify(__state.points)),before);assert.equal(await page.locator('#pointsBody .cell-seq').first().innerText(),await page.evaluate(()=>String(__state.points[0].seq||'')));
  await page.locator('[data-language="ar-EG"]').click();await page.waitForFunction('document.documentElement.lang==="ar-EG"');
  fs.mkdirSync('output/android-tests/i18n',{recursive:true});await page.screenshot({path:'output/android-tests/i18n/arabic-desktop.png'});
  await page.setViewportSize({width:360,height:800});for(const code of ['zh-CN','en','ar-EG']){await page.locator('[data-language="'+code+'"]').click();const b=await page.locator('[data-language="'+code+'"]').boundingBox();assert.ok(b.x>=0&&b.x+b.width<=360,'flag within narrow screen');}
  await page.screenshot({path:'output/android-tests/i18n/arabic-narrow.png'});
  await page.reload();await page.waitForFunction('document.documentElement.lang==="ar-EG"');assert.equal(await page.locator('[data-language="ar-EG"]').getAttribute('aria-pressed'),'true');
  await page.locator('[data-language="zh-CN"]').click();await page.waitForFunction('document.documentElement.dir==="ltr"');assert.equal(await page.locator('#savePointsBtn').innerText(),'保存');
  assert.deepEqual(errors,[]);console.log('PASS three languages, dynamic tables, data/draft preservation, RTL, narrow flags and persistence');
 }finally{await browser?.close();app.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
