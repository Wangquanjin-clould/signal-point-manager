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
    int pointKeyboardMode=0;
    boolean legacyKeyboardVisible=false;
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        ((android.app.job.JobScheduler)getSystemService(JOB_SCHEDULER_SERVICE)).cancel(901);
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
        else layout.getViewTreeObserver().addOnGlobalLayoutListener(()->{
            android.graphics.Rect frame=new android.graphics.Rect();
            layout.getWindowVisibleDisplayFrame(frame);
            if(frame.isEmpty()||layout.getHeight()==0)return;
            int[] origin=new int[2];layout.getLocationOnScreen(origin);
            int left=Math.max(0,frame.left-origin[0]),top=Math.max(0,frame.top-origin[1]);
            int right=Math.max(0,origin[0]+layout.getWidth()-frame.right);
            int bottom=Math.max(0,origin[1]+layout.getHeight()-frame.bottom);
            if(layout.getPaddingLeft()!=left||layout.getPaddingTop()!=top||layout.getPaddingRight()!=right||layout.getPaddingBottom()!=bottom)
                layout.setPadding(left,top,right,bottom);
            boolean keyboard=getWindow().getDecorView().getHeight()-frame.bottom>getWindow().getDecorView().getHeight()/4;
            if(legacyKeyboardVisible&&!keyboard)layout.postDelayed(this::enterFullscreen,150);
            legacyKeyboardVisible=keyboard;
        });
        web=new WebView(this){
            @Override public android.view.inputmethod.InputConnection onCreateInputConnection(android.view.inputmethod.EditorInfo info){
                if(pointKeyboardMode==3)return null;
                android.view.inputmethod.InputConnection connection=super.onCreateInputConnection(info);
                if(pointKeyboardMode==0||connection==null)return connection;
                info.inputType=pointKeyboardMode==2?android.text.InputType.TYPE_CLASS_NUMBER:
                    android.text.InputType.TYPE_CLASS_TEXT|
                    android.text.InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS|android.text.InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS;
                if(pointKeyboardMode==1){info.imeOptions|=android.view.inputmethod.EditorInfo.IME_FLAG_FORCE_ASCII;info.initialCapsMode=android.text.TextUtils.CAP_MODE_CHARACTERS;}
                return new android.view.inputmethod.InputConnectionWrapper(connection,false){
                    @Override public int getCursorCapsMode(int modes){return pointKeyboardMode==1?android.text.TextUtils.CAP_MODE_CHARACTERS:super.getCursorCapsMode(modes);}
                };
            }
        };
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
        if(prefs.getString("token","").isEmpty())new Handler(Looper.getMainLooper()).postDelayed(this::configure,900);
    }
    WebResourceResponse denied(){return new WebResourceResponse("text/plain","UTF-8",403,"Blocked",Collections.emptyMap(),new ByteArrayInputStream(new byte[0]));}
    void configure() {
        LinearLayout box=new LinearLayout(this);box.setOrientation(1);box.setPadding(30,8,30,8);
        EditText url=new EditText(this);url.setInputType(android.text.InputType.TYPE_CLASS_TEXT|android.text.InputType.TYPE_TEXT_VARIATION_URI);url.setHint("VPS HTTPS 地址");url.setText(prefs.getString("url","https://107.173.154.48:10443"));box.addView(url);
        EditText token=new EditText(this);token.setHint("移动端同步密钥");token.setInputType(129);token.setText(prefs.getString("token",""));box.addView(token);
        new AlertDialog.Builder(this).setTitle("首次下载 / 同步设置").setView(box).setMessage("数据库保存在手机。首次下载需联网，之后可离线使用。基础配置使用服务器管理员账号，联网登录成功后可离线登录。")
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
        @JavascriptInterface public void pointKeyboard(int mode){runOnUiThread(()->{
            if(web==null||isDestroyed()||mode<0||mode>3||pointKeyboardMode==mode)return;
            pointKeyboardMode=mode;
            android.view.inputmethod.InputMethodManager keyboard=(android.view.inputmethod.InputMethodManager)getSystemService(INPUT_METHOD_SERVICE);
            if(mode==3){keyboard.hideSoftInputFromWindow(web.getWindowToken(),0);keyboard.restartInput(web);enterFullscreen();return;}
            keyboard.restartInput(web);
            if(mode>0)web.postDelayed(()->{if(pointKeyboardMode==mode&&web.hasWindowFocus())keyboard.showSoftInput(web,android.view.inputmethod.InputMethodManager.SHOW_IMPLICIT);},100);
        });}
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
    @Override protected void onResume(){super.onResume();visible=true;enterFullscreen();}
    @Override protected void onPause(){visible=false;super.onPause();}
    @Override protected void onDestroy(){visible=false;if(callback!=null)((android.net.ConnectivityManager)getSystemService(CONNECTIVITY_SERVICE)).unregisterNetworkCallback(callback);if(web!=null){web.removeJavascriptInterface("NativeStore");web.destroy();}if(database!=null)database.close();super.onDestroy();}
    @Override public void onBackPressed(){if(web!=null)web.evaluateJavascript("if(window.PointKeyboard?.isOpen())PointKeyboard.close();else document.getElementById('backToOverview')?.click()",null);else super.onBackPressed();}
}
