'use strict';
const fs=require('node:fs');
const path=require('node:path');
const out=path.join(__dirname,'app/src/main/assets/web');
fs.mkdirSync(out,{recursive:true});fs.cpSync(path.join(__dirname,'../public'),out,{recursive:true});
const server=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
const rules=fs.readFileSync(path.join(__dirname,'../db.js'),'utf8');
const between=(s,start,end)=>{const a=s.indexOf(start),b=s.indexOf(end,a);if(a<0||b<0)throw Error('Missing source boundary '+start);return s.slice(a,b);};
const business=between(server,'function listSignalTypes(','/* ============================ 认证 API');
const routes=between(server,"route('GET', '/api/signal-types'",'/* 静态资源');
const functions=between(rules,'function computeSensorType(','function purgeExpiredSessions(')+between(rules,'function computePlcExpression(','module.exports =');
const generated=fs.readFileSync(path.join(__dirname,'runtime/prefix.js'),'utf8')+'\n'+functions+'\n'+business+'\n'+routes+'\n'+fs.readFileSync(path.join(__dirname,'runtime/suffix.js'),'utf8');
fs.writeFileSync(path.join(out,'runtime.js'),generated);
fs.copyFileSync(path.join(__dirname,'../sync-core.js'),path.join(out,'sync-core.js'));
fs.copyFileSync(path.join(__dirname,'runtime/prefix.js'),path.join(out,'native-prefix.js'));
fs.copyFileSync(path.join(__dirname,'runtime/background.js'),path.join(out,'background.js'));
fs.writeFileSync(path.join(out,'background-worker.js'),fs.readFileSync(path.join(__dirname,'runtime/prefix.js'),'utf8')+fs.readFileSync(path.join(__dirname,'runtime/background.js'),'utf8'));
fs.writeFileSync(path.join(out,'background.html'),'<html><head><script src="/sync-core.js"></script><script src="/background-worker.js"></script></head></html>');
let html=fs.readFileSync(path.join(out,'index.html'),'utf8').replace('<script src="/app.js"></script>','<script src="/sync-core.js"></script><script src="/runtime.js"></script><script src="/app.js"></script>');
html=html.replace('<head>','<head><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\' data:; connect-src \'self\'; frame-src \'none\'; object-src \'none\'; base-uri \'self\'">');
html=html.replace('<div class="nav-foot">',`<button class="nav-item" id="mobileSyncNavBtn" title="立即同步（长按设置）" aria-label="立即同步">
  <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5M6.1 7a7 7 0 0111.5-1L20 9M4 15l2.4 3A7 7 0 0018 17" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
  <span>立即同步</span>
</button><div class="nav-foot">`);
fs.writeFileSync(path.join(out,'index.html'),html);
let app=fs.readFileSync(path.join(out,'app.js'),'utf8').replace("if ('serviceWorker' in navigator)","if (!window.NativeStore && 'serviceWorker' in navigator)");
fs.writeFileSync(path.join(out,'app.js'),app);
console.log('Bundled current website, routes and PLC rules for native SQLite');
