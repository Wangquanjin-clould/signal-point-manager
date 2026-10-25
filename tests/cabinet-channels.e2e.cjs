'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process'),{once}=require('node:events');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const dir=path.resolve('tmp/cabinet-channel-ui-'+Date.now());fs.mkdirSync(dir,{recursive:true});
 const app=spawn(process.execPath,['-e',"const s=require('./server');s.on('listening',()=>process.send(s.address().port))"],{cwd:path.resolve('.'),env:{...process.env,DATA_DIR:dir,PORT:'0',HOST:'127.0.0.1'},stdio:['ignore','ignore','inherit','ipc']});
 let browser;
 try{
  const [port]=await once(app,'message'),base='http://127.0.0.1:'+port;
  browser=await chromium.launch({channel:'msedge',headless:true});const context=await browser.newContext({baseURL:base,viewport:{width:1280,height:800}}),page=await context.newPage();page.setDefaultTimeout(15000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const cfg=await(await context.request.get('/api/config')).json(),model=cfg.module_models[0],project=cfg.projects[0],cabinet=cfg.cabinets[0],otherCabinet=cfg.cabinets[1];
  const create=async(no,cab,proj=project)=>{const r=await context.request.post('/api/modules',{data:{project_id:proj.id,cabinet_id:cab.id,module_no:no,module_type_id:model.module_type_id,module_model_id:model.id}});assert.equal(r.status(),200);return(await r.json()).id;};
  const first=await create('1',cabinet);await create('2',cabinet);const second=await create('1',otherCabinet);await create('1',cabinet,cfg.projects[1]);
  const point=(await(await context.request.get('/api/points?module_id='+first)).json()).items[0];await context.request.patch('/api/points/'+point.id,{data:{point_name:'CABINET_A_ONLY',part:'B'}});
  await page.goto(base);await page.waitForFunction('window.__state?.tree.length>0');await page.evaluate(([p,c])=>selectCabinet(p,c),[project.id,cabinet.id]);
  await page.waitForFunction(n=>document.querySelectorAll('#cabinetChannelsBody tr').length===n,model.channel_count*2);
  assert.equal(await page.locator('#cabinetChannels').isVisible(),true);assert.ok((await page.locator('#cabinetChannelsBody').innerText()).includes('CABINET_A_ONLY'));
  assert.ok((await page.locator('#cabinetChannelsStatus').innerText()).includes('备用'));
  const moduleBox=await page.locator('#moduleCards').boundingBox(),channelBox=await page.locator('#cabinetChannels').boundingBox();assert.ok(channelBox.y>=moduleBox.y+moduleBox.height);
  assert.ok((await page.locator('#cabinetChannels thead').innerText()).includes('PLC点位表达式'));
  await page.locator('#cabinetChannels').scrollIntoViewIfNeeded();await page.screenshot({path:'output/android-tests/cabinet-channels-desktop.png'});
  await page.setViewportSize({width:500,height:800});assert.equal(await page.locator('#cabinetChannelsBody tr').first().evaluate(el=>getComputedStyle(el).display),'table-row');
  assert.ok(await page.locator('.cabinet-channel-wrap').evaluate(el=>el.scrollWidth>el.clientWidth));await page.screenshot({path:'output/android-tests/cabinet-channels-narrow.png'});
  await page.route('**/api/points?project_id='+project.id+'&cabinet_id='+cabinet.id,async route=>{await new Promise(r=>setTimeout(r,400));await route.continue();});
  await page.evaluate(([p,a,b])=>{selectCabinet(p,a);selectCabinet(p,b);},[project.id,cabinet.id,otherCabinet.id]);
  await page.waitForFunction(n=>document.querySelectorAll('#cabinetChannelsBody tr').length===n,model.channel_count);await page.waitForTimeout(700);
  assert.equal(await page.locator('#cabinetChannelsBody tr').count(),model.channel_count);assert.ok(!(await page.locator('#cabinetChannelsBody').innerText()).includes('CABINET_A_ONLY'));
  await page.evaluate(p=>selectProject(p),project.id);assert.equal(await page.locator('#cabinetChannels').isVisible(),false);assert.deepEqual(errors,[]);
  console.log('PASS cabinet all-channel table: complete scope, placed below modules, responsive scrolling and stale-response protection');
 }finally{await browser?.close();app.kill();}
})().catch(e=>{console.error(e);process.exitCode=1});
