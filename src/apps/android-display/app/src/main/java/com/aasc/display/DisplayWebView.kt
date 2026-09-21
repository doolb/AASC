package com.aasc.display

import android.annotation.SuppressLint
import android.content.Context
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView

// 显示端 WebView：启用 JS/DOM 存储/混合内容，保证 display.html 与跨域 iframe 内容可渲染
@SuppressLint("SetJavaScriptEnabled")
class DisplayWebView(
    context: Context,
    offlineMode: Boolean,
    private val disableInputAutoZoom: Boolean = false
) : WebView(context) {

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
        // 显示页和控制页按 APK 构建模式使用一致的页面比例；Offline 同时参考当前 Display 的设备类别、长边分辨率和 densityDpi。
        val displayMetrics = resources.displayMetrics
        val deviceClass = WebViewScalePolicy.deviceClass(resources.configuration.smallestScreenWidthDp)
        setInitialScale(
            WebViewScalePolicy.initialScalePercent(
                offlineMode = offlineMode,
                widthPixels = displayMetrics.widthPixels,
                heightPixels = displayMetrics.heightPixels,
                densityDpi = displayMetrics.densityDpi,
                deviceClass = deviceClass
            )
        )
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

    /**
     * 仅为 Offline 控制端收紧 viewport，防止输入框获取焦点并弹出软键盘时页面自动放大。
     *
     * 该策略在页面加载完成后执行，避免修改服务端 upload.html，从而不影响浏览器控制端。
     * 显示端 WebView 和普通 APK 实例使用默认 false，不会改变已有页面行为。
     */
    fun applyInputAutoZoomPolicy() {
        if (!disableInputAutoZoom) return
        evaluateJavascript(
            "(function(){" +
                "var viewport=document.querySelector('meta[name=\"viewport\"]');" +
                "if(!viewport){viewport=document.createElement('meta');" +
                "viewport.name='viewport';" +
                "(document.head||document.documentElement).appendChild(viewport);}" +
                "viewport.setAttribute('content','width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no');" +
                "})();",
            null
        )
    }
}
