package com.engineerservice.points;

import android.app.*;
import android.os.*;
import android.content.*;
import android.database.*;
import android.database.sqlite.*;
import android.net.*;
import android.webkit.*;
import android.widget.*;
import org.json.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

public class MobileStore {
    protected final SQLiteDatabase database;
    protected final android.content.SharedPreferences prefs;
    private final java.util.function.BiConsumer<String,String> resultCallback;
    private long lastClockOffset=Long.MIN_VALUE;
    private final ServerAuth serverAuth;
    public MobileStore(SQLiteDatabase database,android.content.SharedPreferences prefs,java.util.function.BiConsumer<String,String> callback){this.database=database;this.prefs=prefs;this.resultCallback=callback;this.serverAuth=new ServerAuth(prefs);}
        @JavascriptInterface public synchronized String sql(String kind,String sql,String params) {
            try {
                long anchor=prefs.getLong("serverElapsed",-1), at=prefs.getLong("serverAt",0);
                if(anchor>=0 && SystemClock.elapsedRealtime()>=anchor) {
                    long offset=at+SystemClock.elapsedRealtime()-anchor-System.currentTimeMillis();
                    if(lastClockOffset==Long.MIN_VALUE || Math.abs(offset-lastClockOffset)>100) {
                        try { database.execSQL("UPDATE mobile_sync_control SET clock_offset=? WHERE id=1",new Object[]{offset}); lastClockOffset=offset; } catch(SQLiteException ignored) {}
                    }
                }
                JSONArray args=new JSONArray(params);Object[] objects=new Object[args.length()];String[] strings=new String[args.length()];
                for(int i=0;i<args.length();i++){Object value=args.get(i);objects[i]=value==JSONObject.NULL?null:value;strings[i]=value==JSONObject.NULL?null:String.valueOf(value);}
                if(kind.equals("exec")){ database.execSQL(sql);return "{}"; }
                if(kind.equals("all")){
                    JSONArray rows=new JSONArray();
                    try(Cursor c=database.rawQuery(sql,strings)){while(c.moveToNext()){JSONObject row=new JSONObject();for(int i=0;i<c.getColumnCount();i++){Object v=c.isNull(i)?JSONObject.NULL:c.getType(i)==Cursor.FIELD_TYPE_INTEGER?c.getLong(i):c.getType(i)==Cursor.FIELD_TYPE_FLOAT?c.getDouble(i):c.getString(i);row.put(c.getColumnName(i),v);}rows.put(row);}}
                    return rows.toString();
                }
                database.execSQL(sql,objects);
                try(Cursor c=database.rawQuery("SELECT last_insert_rowid(), changes()",null)){c.moveToFirst();return new JSONObject().put("lastInsertRowid",c.getLong(0)).put("changes",c.getInt(1)).toString();}
            }catch(Exception e){return error(e);}
        }
        @JavascriptInterface public boolean initialized(){return prefs.getBoolean("initialized",false);}
        @JavascriptInterface public void serverTime(long timestamp){prefs.edit().putLong("serverAt",timestamp).putLong("serverElapsed",SystemClock.elapsedRealtime()).apply();}
        @JavascriptInterface public void initializedOK(){prefs.edit().putBoolean("initialized",true).apply();}
        @JavascriptInterface public boolean unlock(String password){return !prefs.getString("token","").isEmpty() && prefs.getString("token","").equals(password);}
        @JavascriptInterface public void clearLogin(){serverAuth.logout();}
        @JavascriptInterface public void httpAsync(String method,String payload,String requestId) {
            new Thread(()->{
                String result=http(method,payload);
                new Handler(Looper.getMainLooper()).post(()->resultCallback.accept(requestId,result));
            },"mobile-sync").start();
        }
        @JavascriptInterface public String http(String method,String payload) {
            if(method.equals("AUTH_LOGIN")||method.equals("AUTH_PASSWORD"))return serverAuth.execute(method,payload);
            HttpURLConnection c=null;
            try {
                String base=prefs.getString("url","");String token=prefs.getString("token","");
                if(base.isEmpty()||token.isEmpty())throw new IOException("请先设置同步地址与密钥");
                c=(HttpURLConnection)new URL(base+"/api/mobile/sync").openConnection();
                VpsTls.configure(c);
                c.setInstanceFollowRedirects(false);c.setConnectTimeout(10000);c.setReadTimeout(20000);c.setRequestMethod(method);
                c.setRequestProperty("X-Mobile-Sync-Token",token);
                if(method.equals("POST")){c.setDoOutput(true);c.setRequestProperty("Content-Type","application/json");try(OutputStream out=c.getOutputStream()){out.write(payload.getBytes(StandardCharsets.UTF_8));}}
                int code=c.getResponseCode();
                if(code!=200){
                    String detail="请检查密钥或数据冲突";
                    try(InputStream in=c.getErrorStream();ByteArrayOutputStream out=new ByteArrayOutputStream()){
                        if(in!=null){byte[] b=new byte[1024];int n;while((n=in.read(b))!=-1&&out.size()<20000)out.write(b,0,n);detail=new JSONObject(out.toString("UTF-8")).optString("error",detail);}
                    }catch(Exception ignored){}
                    throw new IOException("同步接口 HTTP "+code+"："+detail);
                }
                try(InputStream in=c.getInputStream();ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[] b=new byte[8192];int n;while((n=in.read(b))!=-1){out.write(b,0,n);if(out.size()>30*1024*1024)throw new IOException("同步数据过大");}return out.toString("UTF-8");}
            }catch(Exception e){return error(e);}finally{if(c!=null)c.disconnect();}
        }
        private String error(Exception e){try{return new JSONObject().put("__error",e.getMessage()==null?e.toString():e.getMessage()).toString();}catch(Exception ignored){return "{\"__error\":\"失败\"}";}}
    }
