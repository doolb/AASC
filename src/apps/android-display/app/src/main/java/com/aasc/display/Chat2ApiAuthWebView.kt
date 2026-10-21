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
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import androidx.webkit.JavaScriptReplyProxy
import android.net.Uri
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
    private var doubaoRequestProfile: JSONObject? = null

    private var doubaoSampleId = ""
    private var doubaoSampleSession = ""
    private var doubaoCleanupState = "waiting"

    private fun currentDoubaoSession(): String = CookieManager.getInstance()
        .getCookie("https://www.doubao.com/chat/").orEmpty().split(';').map { it.trim() }
        .firstOrNull { it.startsWith("sessionid=") }?.substringAfter('=').orEmpty()

    /** 未清理成功时保留已克隆资料，完成按钮只重试同一次样本。 */
    fun prepareDoubaoCompletion(onReady: () -> Unit, onIncomplete: (String) -> Unit) {
        if (doubaoSampleId.isNotEmpty() && currentDoubaoSession() != doubaoSampleSession) {
            onIncomplete("豆包登录账号已变化，请重新打开登录页采集")
            return
        }
        if (doubaoCleanupState == "done" && doubaoRequestProfile != null) { onReady(); return }
        if (doubaoCleanupState == "failed") {
            doubaoCleanupState = "cleaning"
            evaluateJavascript("window.__aascDoubaoRetryCleanup?.()", null)
        }
        onIncomplete(if (doubaoSampleId.isEmpty()) "请在官网新会话发送一条消息并等回复完成"
            else "已克隆登录资料，正在清理验证用临时聊天；若失败请点完成重试")
    }

    init {
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.cacheMode = WebSettings.LOAD_NO_CACHE
        settings.javaScriptCanOpenWindowsAutomatically = false
        settings.setSupportMultipleWindows(false)
        CookieManager.getInstance().setAcceptCookie(true)
        if (profile.captureDoubaoNodeProfile
            && WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)
            && WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            WebViewCompat.addWebMessageListener(this, "AASCDoubaoCapture", setOf("https://www.doubao.com"),
                object : WebViewCompat.WebMessageListener {
                    override fun onPostMessage(view: WebView, message: WebMessageCompat, sourceOrigin: Uri,
                        isMainFrame: Boolean, replyProxy: JavaScriptReplyProxy) {
                        if (!isMainFrame || sourceOrigin.toString() != "https://www.doubao.com") return
                        if (stopped.get()) return
                        val input = try { JSONObject(message.data.orEmpty()) } catch (_: Exception) { return }
                        val sampleId = input.optString("sampleId")
                        if (!Regex("^[0-9]{1,32}$").matches(sampleId) || sampleId == "0") return
                        if (input.optString("type") == "cleanup") {
                            if (sampleId != doubaoSampleId || doubaoRequestProfile == null) return
                            if (currentDoubaoSession() != doubaoSampleSession) { doubaoCleanupState = "failed"; return }
                            doubaoCleanupState = if (input.optBoolean("success")) "done" else "failed"
                            if (doubaoCleanupState == "done") {
                                synchronized(captured) { captured["requestProfile"] = doubaoRequestProfile.toString() }
                                if (restoreStatus == null) pollCapture()
                            }
                            return
                        }
                        if (doubaoSampleId.isNotEmpty()) return
                        val normalized = Chat2ApiDoubaoRequestCapture.normalize(message.data) ?: return
                        val sampleSession = currentDoubaoSession()
                        if (sampleSession.length !in 16..512) return
                        doubaoSampleId = sampleId
                        doubaoSampleSession = sampleSession
                        doubaoRequestProfile = normalized
                        doubaoCleanupState = "cleaning"
                        replyProxy.postMessage(JSONObject().put("type", "cleanup").put("sampleId", sampleId).toString())
                    }
                })
            WebViewCompat.addDocumentStartJavaScript(this, Chat2ApiDoubaoRequestCapture.script, setOf("https://www.doubao.com"))
        }
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
        if (profile.captureDoubaoNodeProfile && doubaoCleanupState != "done") {
            prepareDoubaoCompletion({}, onIncomplete)
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
            mergeCaptured(merged)
            if (!emitIfComplete()) {
                onIncomplete(if (profile.captureDoubaoNodeProfile) "豆包Node登录资料尚未就绪，请等待登录完成后重试" else "尚未捕获完整登录凭据，请完成网页登录后重试")
            }
        }
    }

    /** 仅在用户点击已存豆包账号的“完成”时读取两个官网来源当前适用的 Cookie。 */
    fun captureDoubaoCookieSnapshot(): JSONObject? {
        if (stopped.get()) return null
        val origins = listOf("https://www.doubao.com", "https://accounts.doubao.com")
        if (origins.any { !Chat2ApiCredentialCapture.isAllowed(profile, it) }) return null
        val snapshot = JSONObject()
        val manager = CookieManager.getInstance()
        for (origin in origins) {
            val value = manager.getCookie("$origin/")?.trim().orEmpty()
            if (value.isNotEmpty() && value.length <= 32 * 1024) snapshot.put(origin, value)
        }
        return snapshot.takeIf { it.has(origins.first()) }
    }

    /** 已由官网完整聊天事件确认的首轮模板；返回副本，避免Activity持有可变WebView状态。 */
    fun captureDoubaoRequestProfile(): JSONObject? =
        if (doubaoCleanupState == "done" && currentDoubaoSession() == doubaoSampleSession)
            doubaoRequestProfile?.let { JSONObject(it.toString()) } else null

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
        doubaoRequestProfile = null
        doubaoSampleId = ""
        doubaoSampleSession = ""
        doubaoCleanupState = "waiting"
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
        restoreCookies.filter { Chat2ApiCredentialCapture.normalizeOrigin(it.origin) == pageUrlOrigin(pageUrl) }.forEach { mapping ->
            manager.setCookie(mapping.origin, "${mapping.name}=${mapping.value}; Path=/")
        }
        manager.flush()
    }

    private fun restorePageIfNeeded(pageUrl: String) {
        val status = restoreStatus ?: return
        if (!Chat2ApiCredentialCapture.isAllowed(profile, pageUrl)) {
            status(Chat2ApiCredentialRestore.pageStatus(profile, pageUrl, false))
            return
        }
        if (restoreCookies.isEmpty() && restoreLocalStorage.isEmpty()) {
            status(Chat2ApiCredentialRestore.pageStatus(profile, pageUrl, false))
            return
        }
        val pageStorage = restoreLocalStorage.filter { Chat2ApiCredentialCapture.normalizeOrigin(it.origin) == pageUrlOrigin(pageUrl) }
        if (pageStorage.isNotEmpty() && !restoreInjected) {
            val script = Chat2ApiCredentialRestore.localStorageScript(pageStorage)
            evaluateJavascript(script) {
                if (pageUrlOrigin(url.orEmpty()) != pageUrlOrigin(pageUrl)) return@evaluateJavascript
                restoreInjected = true
                if (!restoreReloaded) {
                    restoreReloaded = true
                    status("${Chat2ApiCredentialRestore.sourceLabel(pageUrl)}；已注入网页存储，正在刷新确认登录状态")
                    reload()
                } else {
                    status(Chat2ApiCredentialRestore.pageStatus(profile, pageUrl, true))
                }
            }
            return
        }
        status(Chat2ApiCredentialRestore.pageStatus(profile, pageUrl, true))
    }

    private fun pageUrlOrigin(value: String): String? {
        return Chat2ApiCredentialCapture.normalizeOrigin(value)
    }

    private fun pollCapture() {
        if (stopped.get() || pollCount >= 30 || lastUrl.isBlank()) return
        pollCount += 1
        val captureUrl = lastUrl
        readPageCredentials(captureUrl) { merged ->
            mergeCaptured(merged)
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
        // 仅Cookie认证的Provider直接读取CookieManager，集合筛选仍由同一声明式捕获器执行。
        // 不执行空的网页存储脚本，减少完成按钮与页面导航之间的异步窗口。
        if (profile.localStorageFields.isEmpty() && !profile.captureDoubaoNodeProfile) {
            callback(Chat2ApiCredentialCapture.merge(profile, pageUrl, cookies = CookieManager.getInstance().getCookie(pageUrl)))
            return
        }
        val keys = profile.localStorageFields.keys.toList() +
            if (profile.captureDoubaoNodeProfile) Chat2ApiDoubaoNodeCapture.storageKeys else emptyList()
        val storageKeys = JSONArray(keys.distinct()).toString()
        val script = """
            (function() {
              const keys = $storageKeys;
              const result = {};
              for (const key of keys) { try { const value = localStorage.getItem(key); if (value) result[key] = value; } catch (_) {} }
              return JSON.stringify({ storage: result, userAgent: navigator.userAgent });
            })();
        """.trimIndent()
        evaluateJavascript(script) { raw ->
            // 导航或停止后返回的旧页面结果不能与新页面Cookie拼接。
            if (stopped.get() || pageUrlOrigin(url.orEmpty()) != pageUrlOrigin(pageUrl)) {
                callback(emptyMap())
                return@evaluateJavascript
            }
            val page = parsePageCredentials(raw, keys)
            val cookies = CookieManager.getInstance().getCookie(pageUrl)
            val merged = Chat2ApiCredentialCapture.merge(profile, pageUrl, cookies = cookies, localStorage = page.first, userAgent = page.second)
            val snapshot = if (profile.captureDoubaoNodeProfile) captureDoubaoCookieSnapshot() else null
            callback(if (snapshot == null) merged else merged + ("cookieSnapshot" to snapshot.toString()))
        }
    }

    /** 更新Cookie的同批结果没有有效profile时删除旧资料，避免一次登录中身份切换后拼出混合快照。 */
    private fun mergeCaptured(merged: Map<String, String>) {
        synchronized(captured) {
            if (profile.captureDoubaoNodeProfile && merged.containsKey("cookie")) {
                captured.remove("nodeProfile")
                captured.remove("cookieSnapshot")
            }
            captured.putAll(merged)
        }
    }

    private fun emitIfComplete(): Boolean {
        if (profile.captureDoubaoNodeProfile && (doubaoCleanupState != "done"
            || currentDoubaoSession() != doubaoSampleSession)) return false
        val snapshot = synchronized(captured) { captured.toMap() }
        if (Chat2ApiCredentialCapture.hasRequiredFields(profile, snapshot)
            && stopped.compareAndSet(false, true)) {
            mainHandler.removeCallbacksAndMessages(null)
            mainHandler.post { onCredentialsCaptured(snapshot) }
            return true
        }
        return Chat2ApiCredentialCapture.hasRequiredFields(profile, snapshot)
    }

    private fun parsePageCredentials(raw: String?, keys: List<String>): Pair<Map<String, String>, String?> {
        if (raw.isNullOrBlank() || raw == "null" || raw.length > 128 * 1024) return emptyMap<String, String>() to null
        return try {
            val decoded = JSONObject("{\"value\":$raw}").optString("value")
            val json = JSONObject(decoded)
            val storage = json.optJSONObject("storage") ?: JSONObject()
            keys.associateWith { key -> storage.optString(key).takeIf(String::isNotEmpty) ?: "" }
                .filterValues(String::isNotEmpty) to json.optString("userAgent").takeIf(String::isNotEmpty)
        } catch (_: Exception) {
            emptyMap<String, String>() to null
        }
    }
}
