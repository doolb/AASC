package com.aasc.display

import android.annotation.SuppressLint
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.webkit.CookieManager
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebStorage
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
    private var restoreCookies: List<Chat2ApiRestoreCookie> = emptyList()
    private var restoreLocalStorage: List<Chat2ApiRestoreLocalStorage> = emptyList()
    private var restoreStatus: ((String) -> Unit)? = null
    private var restoreInjected = false
    private var restoreReloaded = false
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
                restorePageIfNeeded(url)
                if (restoreStatus == null) pollCapture()
                super.onPageFinished(view, url)
            }

            override fun onPageStarted(view: WebView, url: String, favicon: android.graphics.Bitmap?) {
                applyRestoreCookies(url)
                super.onPageStarted(view, url, favicon)
            }
        }
    }

    fun start(loginUrl: String) {
        lastUrl = loginUrl
        loadUrl(loginUrl)
    }

    /**
     * 外部网页模式只恢复服务端明确下发的映射，不调用登录捕获回调，也不把凭证写入 WebView 之外的持久化存储。
     */
    fun startRestore(
        loginUrl: String,
        cookies: List<Chat2ApiRestoreCookie>,
        localStorage: List<Chat2ApiRestoreLocalStorage>,
        onStatus: (String) -> Unit
    ) {
        restoreCookies = cookies.filter { Chat2ApiCredentialCapture.isAllowed(profile, it.origin) }
        restoreLocalStorage = localStorage.filter { Chat2ApiCredentialCapture.isAllowed(profile, it.origin) }
        restoreStatus = onStatus
        restoreInjected = false
        restoreReloaded = false
        val manager = CookieManager.getInstance()
        restoreCookies.forEach { mapping ->
            manager.setCookie(mapping.origin, "${mapping.name}=${mapping.value}; Path=/")
        }
        manager.flush()
        start(loginUrl)
    }

    /**
     * 原生“完成”按钮使用的即时捕获入口。
     * 先读取当前允许页面的 localStorage/Cookie，再和已经从请求头捕获的字段合并；
     * 凭据不完整时只回调提示，不停止 WebView 或既有轮询。
     */
    fun completeCapture(onIncomplete: (String) -> Unit) {
        if (stopped.get()) {
            onIncomplete("登录捕获已结束")
            return
        }
        // 页面可能已经跳转离开允许域名；只要此前已从允许请求捕获完整字段，仍可安全完成登录。
        val existing = synchronized(captured) { captured.toMap() }
        if (Chat2ApiCredentialCapture.hasRequiredFields(profile, existing)) {
            emitIfComplete()
            return
        }
        val currentUrl = url?.trim().orEmpty().ifEmpty { lastUrl.trim() }
        if (currentUrl.isEmpty() || !Chat2ApiCredentialCapture.isAllowed(profile, currentUrl)) {
            onIncomplete("当前页面不在允许的登录来源内")
            return
        }
        readPageCredentials(currentUrl) { merged ->
            synchronized(captured) { captured.putAll(merged) }
            if (!emitIfComplete()) {
                onIncomplete("尚未捕获完整登录凭据，请完成网页登录后重试")
            }
        }
    }

    fun stopCapture() {
        if (stopped.compareAndSet(false, true)) {
            mainHandler.removeCallbacksAndMessages(null)
        }
    }

    /**
     * 登录流程结束后清理隔离进程中的临时认证数据，避免下一个 Provider 登录复用本次会话。
     * Cookie、Web Storage、缓存和历史记录都不属于已保存账号的一部分，统一在 Activity 销毁前删除。
     */
    fun clearLoginData() {
        stopCapture()
        restoreCookies = emptyList()
        restoreLocalStorage = emptyList()
        restoreStatus = null
        CookieManager.getInstance().removeAllCookies(null)
        CookieManager.getInstance().flush()
        WebStorage.getInstance().deleteAllData()
        clearCache(true)
        clearHistory()
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

    private fun applyRestoreCookies(pageUrl: String) {
        if (restoreStatus == null || !Chat2ApiCredentialCapture.isAllowed(profile, pageUrl)) return
        val manager = CookieManager.getInstance()
        restoreCookies.filter { it.origin == pageUrlOrigin(pageUrl) }.forEach { mapping ->
            manager.setCookie(mapping.origin, "${mapping.name}=${mapping.value}; Path=/")
        }
        manager.flush()
    }

    private fun restorePageIfNeeded(pageUrl: String) {
        val status = restoreStatus ?: return
        if (!Chat2ApiCredentialCapture.isAllowed(profile, pageUrl)) {
            status("当前网页不在允许的恢复来源内，已跳过凭证注入")
            return
        }
        if (restoreCookies.isEmpty() && restoreLocalStorage.isEmpty()) {
            status("当前 Provider 不支持自动恢复，请在网页中手动登录")
            return
        }
        if (restoreLocalStorage.isNotEmpty() && !restoreInjected) {
            val script = Chat2ApiCredentialRestore.localStorageScript(restoreLocalStorage)
            evaluateJavascript(script) {
                restoreInjected = true
                if (!restoreReloaded) {
                    restoreReloaded = true
                    status("已注入网页存储，正在刷新确认登录状态")
                    reload()
                } else {
                    status("已尝试恢复登录状态，可继续手动登录")
                }
            }
            return
        }
        status("已尝试恢复登录状态，可继续手动登录")
    }

    private fun pageUrlOrigin(value: String): String? {
        return try {
            java.net.URI(value).let { uri ->
                val port = if (uri.port > 0) ":${uri.port}" else ""
                "${uri.scheme}://${uri.host}$port"
            }
        } catch (_: Exception) {
            null
        }
    }

    private fun pollCapture() {
        if (stopped.get() || pollCount >= 30 || lastUrl.isBlank()) return
        pollCount += 1
        val captureUrl = lastUrl
        readPageCredentials(captureUrl) { merged ->
            synchronized(captured) { captured.putAll(merged) }
            emitIfComplete()
            val snapshot = synchronized(captured) { captured.toMap() }
            if (!stopped.get() && !Chat2ApiCredentialCapture.hasRequiredFields(profile, snapshot)) {
                mainHandler.postDelayed({ pollCapture() }, 1_000L)
            }
        }
    }

    private fun readPageCredentials(pageUrl: String, callback: (Map<String, String>) -> Unit) {
        if (!Chat2ApiCredentialCapture.isAllowed(profile, pageUrl)) {
            callback(emptyMap())
            return
        }
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
            val cookies = CookieManager.getInstance().getCookie(pageUrl)
            callback(Chat2ApiCredentialCapture.merge(profile, pageUrl, cookies = cookies, localStorage = localStorage))
        }
    }

    private fun emitIfComplete(): Boolean {
        val snapshot = synchronized(captured) { captured.toMap() }
        if (Chat2ApiCredentialCapture.hasRequiredFields(profile, snapshot)
            && stopped.compareAndSet(false, true)) {
            mainHandler.removeCallbacksAndMessages(null)
            mainHandler.post { onCredentialsCaptured(snapshot) }
            return true
        }
        return Chat2ApiCredentialCapture.hasRequiredFields(profile, snapshot)
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
