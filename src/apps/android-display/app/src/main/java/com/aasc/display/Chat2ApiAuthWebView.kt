package com.aasc.display

import android.annotation.SuppressLint
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.webkit.CookieManager
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Chat2API 专用登录 WebView：使用独立进程的 Cookie/Storage，并且只采集 profile 声明的字段。
 * 凭据只通过回调留在内存中，不能写日志、SharedPreferences 或普通显示页。
 */
@SuppressLint("SetJavaScriptEnabled")
class Chat2ApiAuthWebView(
    context: Context,
    private val profile: Chat2ApiCaptureProfile,
    private val onCredentialsCaptured: (Map<String, String>) -> Unit
) : WebView(context) {

    private val mainHandler = Handler(Looper.getMainLooper())
    private val stopped = AtomicBoolean(false)
    private val captured = linkedMapOf<String, String>()
    private var lastUrl: String = ""
    private var pollCount = 0

    init {
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.cacheMode = WebSettings.LOAD_NO_CACHE
        settings.javaScriptCanOpenWindowsAutomatically = false
        settings.setSupportMultipleWindows(false)
        CookieManager.getInstance().setAcceptCookie(true)
        webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): android.webkit.WebResourceResponse? {
                captureRequest(request.url.toString(), request.requestHeaders)
                return super.shouldInterceptRequest(view, request)
            }

            override fun onPageFinished(view: WebView, url: String) {
                lastUrl = url
                pollCapture()
                super.onPageFinished(view, url)
            }
        }
    }

    fun start(loginUrl: String) {
        lastUrl = loginUrl
        loadUrl(loginUrl)
    }

    fun stopCapture() {
        if (stopped.compareAndSet(false, true)) {
            mainHandler.removeCallbacksAndMessages(null)
        }
    }

    private fun captureRequest(url: String, headers: Map<String, String>?) {
        if (stopped.get() || !Chat2ApiCredentialCapture.isAllowed(profile, url)) return
        val authorization = Chat2ApiCredentialCapture.extractAuthorization(headers, profile)
        if (authorization.isNullOrBlank()) return
        val separator = authorization.indexOf('=')
        if (separator <= 0) return
        synchronized(captured) {
            captured[authorization.substring(0, separator)] = authorization.substring(separator + 1)
        }
        emitIfComplete()
    }

    private fun pollCapture() {
        if (stopped.get() || pollCount >= 30 || lastUrl.isBlank()) return
        pollCount += 1
        val storageKeys = JSONArray(profile.localStorageFields.keys.toList()).toString()
        val script = """
            (function() {
              const keys = $storageKeys;
              const result = {};
              for (const key of keys) { try { const value = localStorage.getItem(key); if (value) result[key] = value; } catch (_) {} }
              return JSON.stringify(result);
            })();
        """.trimIndent()
        evaluateJavascript(script) { raw ->
            val localStorage = parseLocalStorage(raw)
            val cookies = CookieManager.getInstance().getCookie(lastUrl)
            val merged = Chat2ApiCredentialCapture.merge(profile, lastUrl, cookies = cookies, localStorage = localStorage)
            synchronized(captured) { captured.putAll(merged) }
            emitIfComplete()
            if (!stopped.get() && !Chat2ApiCredentialCapture.hasRequiredFields(profile, captured)) {
                mainHandler.postDelayed({ pollCapture() }, 1_000L)
            }
        }
    }

    private fun emitIfComplete() {
        val snapshot = synchronized(captured) { captured.toMap() }
        if (Chat2ApiCredentialCapture.hasRequiredFields(profile, snapshot)
            && stopped.compareAndSet(false, true)) {
            mainHandler.removeCallbacksAndMessages(null)
            mainHandler.post { onCredentialsCaptured(snapshot) }
        }
    }

    private fun parseLocalStorage(raw: String?): Map<String, String> {
        if (raw.isNullOrBlank() || raw == "null") return emptyMap()
        return try {
            val decoded = JSONObject("{\"value\":$raw}").optString("value")
            val json = JSONObject(decoded)
            profile.localStorageFields.keys.associateWith { key -> json.optString(key).takeIf(String::isNotEmpty) ?: "" }
                .filterValues(String::isNotEmpty)
        } catch (_: Exception) {
            emptyMap()
        }
    }
}
