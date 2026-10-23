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

public class MainActivity extends Activity {
    public static volatile boolean visible=false;
    WebView web;
    SQLiteDatabase database;
    android.content.SharedPreferences prefs;
    android.net.ConnectivityManager.NetworkCallback callback;
    byte[] pendingExport;
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        ((android.app.job.JobScheduler)getSystemService(JOB_SCHEDULER_SERVICE)).schedule(new android.app.job.JobInfo.Builder(901,new ComponentName(this,SyncJobService.class)).setRequiredNetworkType(android.app.job.JobInfo.NETWORK_TYPE_ANY).setPeriodic(15*60*1000).setPersisted(true).build());
        prefs=getSharedPreferences("mobile",MODE_PRIVATE);
        if(prefs.getString("url","").equals("https://www.engineer-service-report.top:10443"))prefs.edit().putString("url","https://107.173.154.48:10443").apply();
        File dir=getDatabasePath("business.db").getParentFile(); dir.mkdirs();
        database=SQLiteDatabase.openOrCreateDatabase(getDatabasePath("business.db"),null);
        database.setForeignKeyConstraintsEnabled(true);
        LinearLayout layout=new LinearLayout(this); layout.setOrientation(1);
        if(Build.VERSION.SDK_INT>=30)layout.setOnApplyWindowInsetsListener((view,insets)->{
            view.setPadding(0,0,0,insets.getInsets(android.view.WindowInsets.Type.ime()).bottom);
            return insets;
        });
        web=new WebView(this);
        web.getSettings().setJavaScriptEnabled(true); web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setAllowFileAccess(false); web.getSettings().setAllowContentAccess(false);
        web.getSettings().setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        web.addJavascriptInterface(new Bridge(),"NativeStore");
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient(){
            @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request) {
                Uri u=request.getUrl();
                try {
                    if (!"https".equals(u.getScheme()) || !"app.local".equals(u.getHost())) return denied();
                    String name=u.getPath(); if(name.equals("/"))name="/index.html";
                    if(name.contains(".."))return denied();
                    String type=name.endsWith(".js")?"text/javascript":name.endsWith(".css")?"text/css":name.endsWith(".svg")?"image/svg+xml":name.endsWith(".png")?"image/png":"text/html";
                    return new WebResourceResponse(type,"UTF-8",getAssets().open("web"+name));
                } catch(Exception e) { return denied(); }
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request) {
                if(request.getUrl().getPath().equals("/api/export")) web.evaluateJavascript("MobileRuntime.exportFile("+JSONObject.quote(request.getUrl().toString())+")",null);
                return true; // Never attach a native bridge to network content.
            }
        });
        layout.addView(web,new LinearLayout.LayoutParams(-1,0,1)); setContentView(layout);
        enterFullscreen();
        web.loadUrl("https://app.local/index.html");
        callback=new android.net.ConnectivityManager.NetworkCallback(){ @Override public void onAvailable(android.net.Network n) { runOnUiThread(()->web.evaluateJavascript("window.MobileRuntime && MobileRuntime.sync()",null)); }};
        ((android.net.ConnectivityManager)getSystemService(CONNECTIVITY_SERVICE)).registerDefaultNetworkCallback(callback);
        if(prefs.getString("token","").isEmpty())new Handler(Looper.getMainLooper()).postDelayed(this::configure,900);
    }
    WebResourceResponse denied(){return new WebResourceResponse("text/plain","UTF-8",403,"Blocked",Collections.emptyMap(),new ByteArrayInputStream(new byte[0]));}
    void configure() {
        LinearLayout box=new LinearLayout(this);box.setOrientation(1);box.setPadding(30,8,30,8);
        EditText url=new EditText(this);url.setInputType(android.text.InputType.TYPE_CLASS_TEXT|android.text.InputType.TYPE_TEXT_VARIATION_URI);url.setHint("VPS HTTPS 地址");url.setText(prefs.getString("url","https://107.173.154.48:10443"));box.addView(url);
        EditText token=new EditText(this);token.setHint("移动端同步密钥");token.setInputType(129);token.setText(prefs.getString("token",""));box.addView(token);
        new AlertDialog.Builder(this).setTitle("首次下载 / 同步设置").setView(box).setMessage("数据库保存在手机。首次下载需联网，之后可离线使用。同步密钥也用于本机基础配置登录（账号 mobile）。")
          .setNegativeButton("取消",null).setPositiveButton("保存并同步",(d,w)->{
              String base=url.getText().toString().trim().replaceAll("/+$","");
              boolean https=base.startsWith("https://") && Uri.parse(base).getHost()!=null;
              boolean test=BuildConfig.DEBUG && (base.matches("http://10\\.0\\.2\\.2:\\d+")||base.matches("http://127\\.0\\.0\\.1:\\d+"));
              if((!https&&!test)||token.length()<32){Toast.makeText(this,"请填写有效 HTTPS 地址和至少32位同步密钥",Toast.LENGTH_LONG).show();return;}
              prefs.edit().putString("url",base).putString("token",token.getText().toString()).apply();
              web.evaluateJavascript("MobileRuntime.sync()",null);
          }).show();
    }
    public class Bridge extends MobileStore {
        Bridge(){super(MainActivity.this.database,MainActivity.this.prefs,(id,result)->{if(web!=null&&!isDestroyed())web.evaluateJavascript("MobileRuntime.onHttpResult("+JSONObject.quote(id)+","+JSONObject.quote(result)+")",null);});}
        @JavascriptInterface public void openSyncSettings(){runOnUiThread(()->{if(!isFinishing()&&!isDestroyed())configure();});}
        @JavascriptInterface public void saveFile(String base64,String name,String mime){
            pendingExport=android.util.Base64.decode(base64,android.util.Base64.DEFAULT);
            runOnUiThread(()->{Intent i=new Intent(Intent.ACTION_CREATE_DOCUMENT).setType(mime).addCategory(Intent.CATEGORY_OPENABLE).putExtra(Intent.EXTRA_TITLE,name);startActivityForResult(i,91);});
        }
    }
    @Override protected void onActivityResult(int request,int result,Intent data){super.onActivityResult(request,result,data);if(request==91&&result==RESULT_OK&&data!=null&&pendingExport!=null){try(OutputStream out=getContentResolver().openOutputStream(data.getData())){out.write(pendingExport);Toast.makeText(this,"导出完成",Toast.LENGTH_SHORT).show();}catch(Exception e){Toast.makeText(this,"导出失败",Toast.LENGTH_LONG).show();}}pendingExport=null;}
    void enterFullscreen(){
        if(Build.VERSION.SDK_INT>=30){
            getWindow().setDecorFitsSystemWindows(false);
            android.view.WindowInsetsController controller=getWindow().getInsetsController();
            if(controller!=null){
                controller.setSystemBarsBehavior(android.view.WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                controller.hide(android.view.WindowInsets.Type.systemBars());
            }
        }else getWindow().getDecorView().setSystemUiVisibility(
            android.view.View.SYSTEM_UI_FLAG_LAYOUT_STABLE|android.view.View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION|
            android.view.View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN|android.view.View.SYSTEM_UI_FLAG_HIDE_NAVIGATION|
            android.view.View.SYSTEM_UI_FLAG_FULLSCREEN|android.view.View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
    }
    @Override public void onWindowFocusChanged(boolean focus){super.onWindowFocusChanged(focus);if(focus)enterFullscreen();}
    @Override protected void onResume(){super.onResume();visible=true;enterFullscreen();if(web!=null)web.evaluateJavascript("window.MobileRuntime && MobileRuntime.sync()",null);}
    @Override protected void onPause(){visible=false;super.onPause();}
    @Override protected void onDestroy(){visible=false;if(callback!=null)((android.net.ConnectivityManager)getSystemService(CONNECTIVITY_SERVICE)).unregisterNetworkCallback(callback);if(web!=null){web.removeJavascriptInterface("NativeStore");web.destroy();}if(database!=null)database.close();super.onDestroy();}
    @Override public void onBackPressed(){if(web!=null)web.evaluateJavascript("document.getElementById('backToOverview')?.click()",null);else super.onBackPressed();}
}
