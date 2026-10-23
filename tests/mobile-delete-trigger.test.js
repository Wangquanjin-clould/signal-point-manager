'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function fixture(statusCode=200,confirmDelete=true){
 const listeners={},timers=[],network=[];const state={pointsDirty:true,points:[{id:1,point_name:'A1'},{id:2,point_name:'G77'}]};
 const pointsBody={addEventListener:(name,fn)=>{listeners[name]=fn;}};
 const bar={textContent:'',style:{}};
 const document={activeElement:null,addEventListener:(name,fn)=>{if(name==='DOMContentLoaded')listeners.ready=fn;},getElementById:id=>id==='pointsBody'?pointsBody:id==='mobileSyncStatus'?bar:{addEventListener(){}},createElement:()=>bar,body:{append(){}}};
 let context;const noop=()=>{};
 const sandbox={window:{__state:state},document,URL,Map,console,confirm:()=>confirmDelete,toast:noop,closeDrawers:noop,renderPoints:noop,refreshSeqAndStats:noop,loadTree:async()=>{},loadConfig:async()=>{},loadSignals:async()=>{},renderOverview:noop,setPointsDirty:v=>{state.pointsDirty=v;},
 setTimeout:(fn,ms)=>{const timer={fn,ms};timers.push(timer);return timer;},clearTimeout:t=>{t.cancelled=true;},
 NativeStore:{initialized:()=>true,initializedOK:noop,serverTime:noop,pointKeyboard:noop,httpAsync:(method,body,id)=>{network.push({method,body});queueMicrotask(()=>sandbox.window.MobileRuntime.onHttpResult(id,JSON.stringify({version:1,records:[],server_time:Date.now()})));}},
 MobileSync:{install:noop,snapshot:()=>[],merge:noop,validateBusiness:noop},db:{exec:noop},transactionDepth:0,parse:JSON.parse,
 matchRoute:()=>({r:{admin:false,handler:async({res})=>{res.status=statusCode;res.data=statusCode<400?{ok:true}:{error:'rejected'};}},params:{}})};
 context=vm.createContext(sandbox);vm.runInContext('(function(){\n'+fs.readFileSync('android/runtime/suffix.js','utf8'),context);listeners.ready();
 async function flush(){for(const t of timers.splice(0)){if(t.ms===0&&!t.cancelled)t.fn();}for(let i=0;i<15;i++)await Promise.resolve();}
 const button={disabled:false,closest:()=>({dataset:{id:'1'}})};
 return {network,state,flush,deletePoint:()=>listeners.click({target:{closest:()=>button},stopImmediatePropagation(){}}),request:(method,url)=>sandbox.window.fetch(url,{method})};
}
test('confirmed point deletion syncs, cancellation and rejection do not; unrelated drafts stay local',async()=>{
 const cancelled=fixture(200,false);await cancelled.deletePoint();await cancelled.flush();assert.equal(cancelled.state.points.length,2);assert.equal(cancelled.network.length,0);
 const denied=fixture(403);await denied.deletePoint();await denied.flush();assert.equal(denied.state.points.length,2);assert.equal(denied.network.length,0);
 const accepted=fixture();await accepted.deletePoint();await accepted.flush();assert.equal(accepted.state.points.length,1);assert.equal(accepted.state.points[0].point_name,'G77');assert.equal(accepted.state.pointsDirty,true);assert.equal(accepted.network.length,1);
});
test('only successful DELETE or module Save trigger sync; normal reads and edits remain local',async()=>{
 for(const [method,url,code,expected] of [['DELETE','/api/modules/1',200,1],['DELETE','/api/config/projects/1',200,1],['DELETE','/api/modules/1',409,0],['GET','/api/tree',200,0],['PATCH','/api/signal-types/1',200,0],['PUT','/api/modules/1/points',200,1]]){
  const f=fixture(code);await f.request(method,url);await f.flush();assert.equal(f.network.length,expected,method+' '+url+' '+code);
 }
});
