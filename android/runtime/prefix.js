/* Adapter for the bundled website. SQL remains inside the private Android SQLite database. */
(function(){
'use strict';
const parse=s=>{const r=JSON.parse(s);if(r&&r.__error)throw Error(r.__error);return r;};
function statements(script){
  let start=0,quote='',out=[];
  for(let i=0;i<script.length;i++){
    const c=script[i];
    if(quote){if(c===quote){if(script[i+1]===quote){i++;}else quote='';}continue;}
    if(c==="'"||c==='"'||c==='`'){quote=c;continue;}
    if(c===';'){
      const part=script.slice(start,i).trim();
      if(/^CREATE TRIGGER/i.test(part)&&! /END\s*$/i.test(part))continue;
      if(part)out.push(part);start=i+1;
    }
  }
  if(script.slice(start).trim())out.push(script.slice(start).trim());return out;
}
let transactionDepth=0;
function execute(part){
 if(/^BEGIN\b/i.test(part)){
   const next=transactionDepth+1;
   parse(NativeStore.sql('exec',transactionDepth?'SAVEPOINT mobile_nested_'+next:part,'[]'));transactionDepth=next;
 }else if(/^COMMIT\b/i.test(part)){
   parse(NativeStore.sql('exec',transactionDepth>1?'RELEASE SAVEPOINT mobile_nested_'+transactionDepth:part,'[]'));transactionDepth=Math.max(0,transactionDepth-1);
 }else if(/^ROLLBACK\s*$/i.test(part)){
   if(transactionDepth>1){parse(NativeStore.sql('exec','ROLLBACK TO SAVEPOINT mobile_nested_'+transactionDepth,'[]'));parse(NativeStore.sql('exec','RELEASE SAVEPOINT mobile_nested_'+transactionDepth,'[]'));}
   else parse(NativeStore.sql('exec',part,'[]'));
   transactionDepth=Math.max(0,transactionDepth-1);
 }else parse(NativeStore.sql('exec',part,'[]'));
}
const db={
  exec:s=>{for(const part of statements(s))execute(part);},
  prepare:sql=>({all:(...args)=>parse(NativeStore.sql('all',sql,JSON.stringify(args))),get:(...args)=>parse(NativeStore.sql('all',sql,JSON.stringify(args)))[0],run:(...args)=>parse(NativeStore.sql('run',sql,JSON.stringify(args)))})
};
class Buffer extends Uint8Array {
 static from(v){return new Buffer(typeof v==='string'?new TextEncoder().encode(v):v);}
 static alloc(n){return new Buffer(n);}
 static concat(parts){const b=new Buffer(parts.reduce((s,p)=>s+p.length,0));let i=0;for(const p of parts){b.set(p,i);i+=p.length;}return b;}
 writeUInt32LE(v,i){new DataView(this.buffer,this.byteOffset,this.byteLength).setUint32(i,v,true);}
 writeUInt16LE(v,i){new DataView(this.buffer,this.byteOffset,this.byteLength).setUint16(i,v,true);}
}
function sendJson(res,status,data){res.status=status;res.data=data;}
async function readBody(req){return req.body||{};}
function str(v,max=200){return v==null?'':String(v).slice(0,max);}
function intOrNull(v){if(v==null||v===''||v==='null')return null;const n=Number(v);return Number.isInteger(n)?n:null;}
