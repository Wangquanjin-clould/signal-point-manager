let localUser=null,busy=false,installed=false,syncAfterSave=false,lastSync='本机模式 · 点击保存后同步',ready=Promise.resolve();
const requests=new Map();let requestId=0;
function remoteRequest(method,body){return new Promise((resolve,reject)=>{
 const id=String(++requestId),timer=setTimeout(()=>{requests.delete(id);reject(Error('同步超时，离线数据已保留'));},40000);
 requests.set(id,{resolve,reject,timer});NativeStore.httpAsync(method,body,id);
});}
const status=text=>{lastSync=text;const bar=document.getElementById('mobileSyncStatus');if(bar)bar.textContent=text;};
async function sync(){
 if(busy)return;busy=true;
 try{
   status('正在同步，请稍候…');
   const had=NativeStore.initialized();
   let payload;
   if(!had){
     payload=await remoteRequest('GET','');
     if(payload.version!==1||!Array.isArray(payload.schema))throw Error('服务器尚未支持移动端同步');
     for(const sql of payload.schema)db.exec(sql);
     MobileSync.install(db);installed=true;
   }else{
     if(!installed){MobileSync.install(db);installed=true;}
     payload=await remoteRequest('POST',JSON.stringify({version:1,records:MobileSync.snapshot(db)}));
   }
   if(payload.version!==1)throw Error('同步协议不匹配');
   NativeStore.serverTime(payload.server_time);
   MobileSync.merge(db,payload.records,{preferIncoming:true,now:payload.server_time,validate:MobileSync.validateBusiness});
   NativeStore.initializedOK();
   status('已同步 '+new Date().toLocaleTimeString()+' · 数据已保存在本机');
   if(!had){await enterApp();return;}
   if(window.__state&&!window.__state.pointsDirty){
     await Promise.all([loadConfig(),loadSignals(),loadTree()]);
     if(window.__state.currentModuleId){
       if(!db.prepare('SELECT id FROM modules WHERE id=?').get(window.__state.currentModuleId)){window.__state.currentModuleId=null;showPage('overview');}
       else await refreshData();
     }
     renderOverview();
   }
 }catch(e){status((NativeStore.initialized()?'离线可用 / 同步未完成：':'首次运行需联网下载：')+e.message);}
 finally{busy=false;if(syncAfterSave){syncAfterSave=false;sync();}}
}
function savedSync(){if(busy)syncAfterSave=true;else sync();}
async function localRequest(input,options={}){
 await ready;
 const url=new URL(input,'https://app.local'),method=options.method||'GET';
 if(!NativeStore.initialized())return {ok:false,status:503,json:async()=>({error:'请先设置同步密钥并联网完成首次下载'})};
 const body=options.body?JSON.parse(options.body):{};
 let data,code=200;
 if(url.pathname.startsWith('/api/auth/')){
   if(url.pathname.endsWith('/login')){if(body.username!=='mobile'||!NativeStore.unlock(body.password))code=401;else localUser={id:null,username:'mobile',role:'admin',must_change_pwd:0};}
   if(url.pathname.endsWith('/logout'))localUser=null;
   data=code===401?{error:'本机基础配置登录：使用 mobile 和同步密钥'}:{user:localUser,allow_register:false,enabled:false};
 }else if(url.pathname.startsWith('/api/users')){code=403;data={error:'账号请在 VPS 网站维护，手机不保存服务器账号和密码哈希'};}
 else{
   const hit=matchRoute(method,url.pathname);
   if(!hit){code=404;data={error:'接口不存在'};}
   else if(hit.r.admin&&!localUser){code=403;data={error:'基础配置需登录'};}
   else{
     const res={status:200,headers:{},writeHead(s,h){this.status=s;this.headers=h;},end(v){this.bytes=typeof v==='string'?Buffer.from(v):v;}};
     const write=method!=='GET';
     try{if(write)db.exec('BEGIN IMMEDIATE');await hit.r.handler({req:{body},res,user:localUser,url,params:hit.params,ip:'local'});code=res.status;data=res.data;
       if(write)db.exec(code<400?'COMMIT':'ROLLBACK');
       if(res.bytes){return {ok:code<400,status:code,headers:res.headers,bytes:res.bytes,json:async()=>JSON.parse(new TextDecoder().decode(res.bytes))};}
     }catch(e){if(write&&transactionDepth)db.exec('ROLLBACK');code=409;data={error:e.message};}
   }
 }
 if(code<400 && method!=='GET' && !url.pathname.startsWith('/api/auth/')){
 status('已保存到本机 · 点击保存或立即同步后上传');
 if(method==='PUT' && /^\/api\/modules\/\d+\/points$/.test(url.pathname))setTimeout(savedSync,0);
 }
 return {ok:code<400,status:code,json:async()=>data};
}
window.fetch=(url,opts)=>localRequest(url,opts);
window.MobileRuntime={sync,db,onHttpResult(id,text){const r=requests.get(id);if(!r)return;requests.delete(id);clearTimeout(r.timer);try{r.resolve(parse(text));}catch(e){r.reject(e);}},async exportFile(url){
 const r=await localRequest(url);if(!r.ok){alert((await r.json()).error);return;}
 const disposition=r.headers['Content-Disposition']||'';
 const match=disposition.match(/filename\*=UTF-8''([^;]+)/i)||disposition.match(/filename="?([^";]+)/i);
 const name=match?decodeURIComponent(match[1]):'点位导出.xlsx';
 let binary='';for(const v of r.bytes)binary+=String.fromCharCode(v);
 NativeStore.saveFile(btoa(binary),name,r.headers['Content-Type']||'application/octet-stream');
}};
if(NativeStore.initialized()){MobileSync.install(db);installed=true;}
document.addEventListener('DOMContentLoaded',()=>{
 const pointKeyboard=()=>{
   const input=document.activeElement;
   if(!input?.matches('input[data-k="point_name"]')){NativeStore.pointKeyboard(0);return;}
   const numeric=/^[A-Za-z]/.test(input.value)&&(input.selectionStart??input.value.length)>0;
   input.inputMode=numeric?'numeric':'text';input.autocapitalize='characters';input.spellcheck=false;
   NativeStore.pointKeyboard(numeric?2:1);
 };
 for(const name of ['focusin','focusout','input','selectionchange'])document.addEventListener(name,pointKeyboard);
 document.getElementById('mobileSyncNavBtn').addEventListener('click',()=>{closeDrawers();NativeStore.openSyncSettings();});
 const bar=document.createElement('div');bar.id='mobileSyncStatus';bar.style.cssText='padding:6px 14px;background:transparent;color:#173467;font-size:12px;position:fixed;bottom:0;left:0;right:0;z-index:9999;';bar.textContent=lastSync;document.body.append(bar);
 if(!NativeStore.initialized())sync();
});



})();
