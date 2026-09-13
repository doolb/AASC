package com.aasc.display

import android.annotation.SuppressLint
import android.content.Context
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
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
        // 禁用 HTTP 缓存：display.html 更新后 APK 重启即加载最新版（避免缓存旧版导致能力缺失）
        settings.cacheMode = WebSettings.LOAD_NO_CACHE
        // 文字/视口归一化：与浏览器渲染一致（WebView 默认 textZoom/wideViewPort 会使文字偏大）
        settings.textZoom = 100
        settings.useWideViewPort = false
        settings.loadWithOverviewMode = false
        settings.setSupportZoom(false)
        isFocusable = true
        isFocusableInTouchMode = true
        requestFocus()

        // getUserMedia 音频采集：APK 内直接授予，无需弹窗（无人值守的显示端）
        webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) {
                val granted = request.resources.filter {
                    it == PermissionRequest.RESOURCE_AUDIO_CAPTURE
                        || it == PermissionRequest.RESOURCE_VIDEO_CAPTURE
                }
                if (granted.isNotEmpty()) {
                    request.grant(granted.toTypedArray())
                } else {
                    request.deny()
                }
            }
        }
    }
}
