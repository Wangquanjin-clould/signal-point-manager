MobileSync.install(db);
window.backgroundResult=function(text){
 try {
   const result=parse(text);
   if(result.version!==1)throw Error('Protocol version');
   NativeStore.serverTime(result.server_time);
   MobileSync.merge(db,result.records,{preferIncoming:true,now:result.server_time,validate:MobileSync.validateBusiness});
   NativeStore.completed(true,'');
 }catch(e){NativeStore.completed(false,e.message);}
};
NativeStore.httpAsync('POST',JSON.stringify({version:1,records:MobileSync.snapshot(db)}),'background');
})();
