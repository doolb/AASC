package com.aasc.display

import android.annotation.SuppressLint
import android.content.Context
import android.webkit.WebSettings
import android.webkit.WebView

// 显示端 WebView：启用 JS/DOM 存储/混合内容，保证 display.html 与跨域 iframe 内容可渲染
@SuppressLint("SetJavaScriptEnabled")
class DisplayWebView(context: Context) : WebView(context) {

    init {
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.mediaPlaybackRequiresUserGesture = false
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
        isFocusable = true
        isFocusableInTouchMode = true
        requestFocus()
    }
}
