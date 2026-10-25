package com.engineerservice.points;

import android.content.SharedPreferences;
import android.util.Base64;
import org.json.JSONObject;
import java.net.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.*;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;

/** Validate server accounts online; cache only a salted local verifier for offline use. */
final class ServerAuth {
    private final SharedPreferences prefs;
    private String cookie="";
    private String cookieBase="";
    ServerAuth(SharedPreferences prefs){this.prefs=prefs;}
    synchronized void logout(){cookie="";cookieBase="";}
    synchronized String execute(String method,String payload){
        try{
            JSONObject body=new JSONObject(payload);
            if(method.equals("AUTH_PASSWORD")){
                if(cookie.isEmpty())throw new IOException("修改服务器密码需要联网重新登录");
                JSONObject result=request("/api/auth/password",body);
                JSONObject cached=new JSONObject(prefs.getString("server_login_cache","{}"));
                if(cached.has("user")){JSONObject user=cached.getJSONObject("user");user.put("mustChangePwd",false);cache(user,body.getString("newPassword"));}
                return result.toString();
            }
            String username=body.optString("username").trim(),password=body.optString("password");
            if(username.isEmpty()||password.isEmpty())throw new IOException("请输入用户名和密码");
            body.put("username",username);
            try{
                JSONObject result=request("/api/auth/login",body);
                JSONObject user=result.getJSONObject("user");
                String role=user.optString("role");
                if(!role.equals("admin")&&!role.equals("user"))throw new IOException("服务器返回无效用户权限");
                cache(user,password);return result.toString();
            }catch(Rejected e){
                logout();
                if(e.code==401){JSONObject cached=new JSONObject(prefs.getString("server_login_cache","{}"));if(cached.optJSONObject("user")!=null&&username.equals(cached.getJSONObject("user").optString("username")))prefs.edit().remove("server_login_cache").apply();}
                throw e;
            }catch(UnknownHostException|ConnectException|SocketTimeoutException|NoRouteToHostException e){
                JSONObject cached=new JSONObject(prefs.getString("server_login_cache","{}"));
                if(!prefs.getString("url","").equals(cached.optString("url"))||cached.optJSONObject("user")==null||!username.equals(cached.getJSONObject("user").optString("username")))throw new IOException("离线登录需先联网成功验证该服务器账号");
                byte[] salt=Base64.decode(cached.getString("salt"),Base64.NO_WRAP);
                if(!MessageDigest.isEqual(verifier(password,salt,cached.optString("algorithm","PBKDF2WithHmacSHA256")),Base64.decode(cached.getString("hash"),Base64.NO_WRAP)))throw new IOException("用户名或密码错误");
                cookie="";return new JSONObject().put("user",cached.getJSONObject("user")).put("offline",true).toString();
            }
        }catch(Exception e){try{return new JSONObject().put("__error",e.getMessage()==null?"服务器登录失败":e.getMessage()).toString();}catch(Exception ignored){return "{\"__error\":\"服务器登录失败\"}";}}
    }
    private byte[] verifier(String password,byte[] salt,String algorithm)throws Exception{
        PBEKeySpec spec=new PBEKeySpec(password.toCharArray(),salt,120000,256);
        try{return SecretKeyFactory.getInstance(algorithm).generateSecret(spec).getEncoded();}finally{spec.clearPassword();}
    }
    private void cache(JSONObject user,String password)throws Exception{
        byte[] salt=new byte[16];new SecureRandom().nextBytes(salt);
        String algorithm="PBKDF2WithHmacSHA256";
        try{SecretKeyFactory.getInstance(algorithm);}catch(NoSuchAlgorithmException unavailable){algorithm="PBKDF2WithHmacSHA1";}
        JSONObject cache=new JSONObject().put("url",prefs.getString("url","")).put("user",user).put("algorithm",algorithm).put("salt",Base64.encodeToString(salt,Base64.NO_WRAP)).put("hash",Base64.encodeToString(verifier(password,salt,algorithm),Base64.NO_WRAP));
        prefs.edit().putString("server_login_cache",cache.toString()).apply();
    }
    private JSONObject request(String path,JSONObject body)throws Exception{
        HttpURLConnection connection=null;
        try{
            String base=prefs.getString("url","");if(!base.equals(cookieBase))logout();
            connection=(HttpURLConnection)new URL(base+path).openConnection();VpsTls.configure(connection);
            connection.setConnectTimeout(10000);connection.setReadTimeout(20000);connection.setInstanceFollowRedirects(false);connection.setRequestMethod("POST");connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type","application/json");if(!cookie.isEmpty())connection.setRequestProperty("Cookie",cookie);
            try(OutputStream out=connection.getOutputStream()){out.write(body.toString().getBytes(StandardCharsets.UTF_8));}
            int code=connection.getResponseCode();
            try(InputStream in=code==200?connection.getInputStream():connection.getErrorStream();ByteArrayOutputStream out=new ByteArrayOutputStream()){
                if(in!=null){byte[] buffer=new byte[4096];int count;while((count=in.read(buffer))!=-1){out.write(buffer,0,count);if(out.size()>1024*1024)throw new IOException("服务器登录响应过大");}}
                JSONObject result=new JSONObject(out.toString("UTF-8"));
                if(code!=200)throw new Rejected(code,result.optString("error","服务器登录失败 HTTP "+code));
                String header=connection.getHeaderField("Set-Cookie");if(header!=null){cookie=header.split(";",2)[0];cookieBase=base;}
                return result;
            }
        }finally{if(connection!=null)connection.disconnect();}
    }
    private static final class Rejected extends IOException {final int code;Rejected(int code,String message){super(message);this.code=code;}}
}
