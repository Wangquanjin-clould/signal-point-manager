'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true,args:['--no-proxy-server']});
 try{
  const base=process.env.VERIFY_URL||'https://107.173.154.48:10443';
  // Certificate validation stays enabled. This check performs only read requests.
  const context=await browser.newContext({baseURL:base,viewport:{width:1280,height:800}}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>assert.equal(r.method(),'GET','Read-only live verification'));
  assert.equal((await page.goto('/')).status(),200);await page.waitForFunction('window.__state?.tree.length>0');
  for(const asset of ['/i18n.js','/icons/flag-cn.svg','/icons/flag-gb.svg','/icons/flag-eg.svg'])assert.equal((await context.request.get(asset)).status(),200);
  await page.locator('[data-language=en]').click();await page.waitForFunction('document.querySelector("#overviewTitle").textContent==="Projects"');
  await page.locator('[data-language="ar-EG"]').click();await page.waitForFunction('document.documentElement.dir==="rtl"');assert.equal(await page.locator('#overviewTitle').innerText(),'نظرة عامة على المشاريع');
  await page.reload();await page.waitForFunction('document.documentElement.lang==="ar-EG" && window.__state?.tree.length>0');
  const scope=await page.evaluate(()=>{for(const p of __state.tree)for(const c of p.cabinets)if(c.modules.length)return[p.id,c.id];});
  if(scope){await page.evaluate(([p,c])=>selectCabinet(p,c),scope);await page.waitForFunction('document.querySelectorAll("#cabinetChannelsBody tr").length>0');assert.equal(await page.locator('#cabinetChannels th').first().innerText(),'رقم الوحدة');}
  fs.mkdirSync('output/android-tests/i18n',{recursive:true});await page.screenshot({path:'output/android-tests/i18n/vps-arabic.png'});
  await page.setViewportSize({width:360,height:800});for(const lang of ['en','ar-EG','zh-CN']){await page.locator('[data-language="'+lang+'"]').click();const box=await page.locator('[data-language="'+lang+'"]').boundingBox();assert.ok(box.x>=0&&box.x+box.width<=360);}
  await page.waitForFunction('document.documentElement.lang==="zh-CN" && document.documentElement.dir==="ltr"');assert.deepEqual(errors,[]);
  console.log('PASS public HTTPS certificate, locale/flag resources, three languages, RTL, persistence, dynamic cabinet table and narrow layout; no production data changed');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
