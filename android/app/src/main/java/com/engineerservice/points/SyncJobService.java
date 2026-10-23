package com.engineerservice.points;
import android.app.job.*;
import android.content.*;
import android.database.sqlite.*;
import android.os.*;
import android.webkit.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.json.JSONObject;

/** Android schedules this persisted job when connected; foreground uses the same sync engine. */
public class SyncJobService extends JobService {
    WebView worker;
    SQLiteDatabase database;
    JobParameters current;
    SharedPreferences prefs;
    Handler handler=new Handler(Looper.getMainLooper());
    Runnable timeout=()->complete(false);
    @Override public boolean onStartJob(JobParameters params) {
        prefs=getSharedPreferences("mobile",MODE_PRIVATE);
        if(MainActivity.visible || !prefs.getBoolean("initialized",false)){android.util.Log.i("SPTSync","Background job skipped: foreground or not initialized");return false;}
        current=params;
        try {
            database=SQLiteDatabase.openDatabase(getDatabasePath("business.db").toString(),null,SQLiteDatabase.OPEN_READWRITE);
            database.setForeignKeyConstraintsEnabled(true);
            worker=new WebView(this);worker.getSettings().setJavaScriptEnabled(true);
            worker.getSettings().setAllowFileAccess(false);worker.getSettings().setAllowContentAccess(false);
            worker.setWebViewClient(new WebViewClient(){@Override public WebResourceResponse shouldInterceptRequest(WebView v,WebResourceRequest r){
                try {
                    android.net.Uri u=r.getUrl();String file=u.getPath();
                    if(!"https".equals(u.getScheme())||!"app.local".equals(u.getHost())||file.contains(".."))throw new IOException("Blocked");
                    return new WebResourceResponse(file.endsWith(".js")?"text/javascript":"text/html","UTF-8",getAssets().open("web"+file));
                }catch(Exception e){return new WebResourceResponse("text/plain","UTF-8",403,"Blocked",Collections.emptyMap(),new ByteArrayInputStream(new byte[0]));}
            }});
            worker.setWebChromeClient(new WebChromeClient(){@Override public boolean onConsoleMessage(ConsoleMessage m){android.util.Log.i("SPTSync",m.message());return true;}});
            worker.addJavascriptInterface(new WorkerStore(),"NativeStore");
            worker.layout(0,0,1,1);worker.onResume();worker.resumeTimers();
            worker.loadUrl("https://app.local/background.html");
            handler.postDelayed(timeout,45000);
            return true;
        }catch(Exception e){android.util.Log.e("SPTSync","Background initialization failed",e);complete(false);return false;}
    }
    String asset(String name)throws IOException{try(InputStream in=getAssets().open(name);ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[] b=new byte[8192];int n;while((n=in.read(b))!=-1)out.write(b,0,n);return out.toString("UTF-8");}}
    public class WorkerStore extends MobileStore {
        WorkerStore(){super(SyncJobService.this.database,SyncJobService.this.prefs,(id,result)->{if(worker!=null)worker.evaluateJavascript("backgroundResult("+JSONObject.quote(result)+")",null);});}
        @JavascriptInterface public void completed(boolean ok,String error){if(!ok)android.util.Log.e("SPTSync",error);handler.post(()->complete(ok));}
    }
    void complete(boolean ok){
        JobParameters params=current;current=null;
        if(ok)prefs.edit().putLong("last_background_sync",System.currentTimeMillis()).apply();
        cleanup();if(params!=null)jobFinished(params,false);
    }
    void cleanup(){handler.removeCallbacks(timeout);if(worker!=null){worker.removeJavascriptInterface("NativeStore");worker.destroy();worker=null;}if(database!=null){database.close();database=null;}}
    @Override public boolean onStopJob(JobParameters params){current=null;cleanup();return true;}
}
