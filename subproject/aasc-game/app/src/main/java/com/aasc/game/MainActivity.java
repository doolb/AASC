package com.aasc.game;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.net.Inet4Address;
import java.net.NetworkInterface;
import java.util.Collections;

/** APK 使用同一套网页；原生桥仅在内置页面暴露房主服务启动能力。 */
public class MainActivity extends Activity {
    private RoomServer server;
    private WebView web;
    private ValueCallback<Uri[]> fileCallback;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        web = new WebView(this);
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                try { startActivityForResult(params.createIntent(), 1001); return true; }
                catch (Exception error) { fileCallback = null; return false; }
            }
        });
        web.setWebViewClient(new WebViewClient() {
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                if (!url.startsWith("file:///android_asset/")) view.removeJavascriptInterface("AascNative");
            }
        });
        web.addJavascriptInterface(new HostBridge(), "AascNative");
        setContentView(web);
        web.loadUrl("file:///android_asset/index.html");
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == 1001 && fileCallback != null) {
            fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data));
            fileCallback = null;
        }
    }

    private String lanAddress() {
        try {
            String fallback = "";
            for (NetworkInterface item : Collections.list(NetworkInterface.getNetworkInterfaces()))
                for (java.net.InetAddress address : Collections.list(item.getInetAddresses()))
                    if (address instanceof Inet4Address && !address.isLoopbackAddress() && item.isUp()) {
                        if (item.getName().startsWith("wlan") || item.getName().startsWith("ap")) return address.getHostAddress();
                        if (address.isSiteLocalAddress()) fallback = address.getHostAddress();
                    }
            return fallback;
        } catch (Exception ignored) { }
        return "";
    }

    private final class HostBridge {
        @JavascriptInterface public String startHost() {
            try {
                String address = lanAddress();
                if (address.isEmpty()) return "ERROR:无法获取局域网地址";
                if (server == null) server = new RoomServer(MainActivity.this, 8765);
                server.start();
                return "http://127.0.0.1:8765/?host=" + server.hostKey() + "&address=" + address + ":8765";
            } catch (Exception error) { return "ERROR:" + error.getMessage(); }
        }
    }

    @Override protected void onDestroy() {
        if (server != null) server.close();
        if (web != null) web.destroy();
        super.onDestroy();
    }
}
