package com.aasc.display

import android.annotation.SuppressLint
import android.content.Intent
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.File
import java.nio.file.Files
import java.util.concurrent.Executors

/** 独立本地启动页不依赖服务HTTP；仅暴露白名单RPC，不复用显示端NativeBridge。 */
class OfflineLauncherActivity : AppCompatActivity() {
    private lateinit var page: WebView
    private val workers = Executors.newCachedThreadPool()
    private var loadedRoot: String? = null
    @Volatile private var documentHtml = ""
    private var resumed = false
    private val pending = java.util.concurrent.ConcurrentHashMap.newKeySet<String>()
    private val listener: (JSONObject) -> Unit = { message ->
        runOnUiThread {
            if (!isDestroyed) {
                if (message.optString("type") == "launcher.ready") loadPage()
                emit(message)
            }
        }
    }

    companion object {
        const val EXTRA_FIRST_RUN_TOKEN = "launcher_first_run_token"
        private const val ORIGIN = OfflineLauncherProtocol.LOCAL_DOCUMENT_URL

    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        if (!OfflineLauncherSession.enabled(this)) { finish(); return }
        page = WebView(this)
        page.settings.apply {
            javaScriptEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            domStorageEnabled = false
            setSupportMultipleWindows(false)
            mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW
        }
        page.addJavascriptInterface(Bridge(), "OfflineLauncher")
        page.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean = true
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse {
                // 主文档也会经过此入口；仅固定顶层首页返回受信任HTML，其余资源一律拒绝。
                if (OfflineLauncherProtocol.isLocalDocument(request.url.toString(), request.isForMainFrame))
                    return WebResourceResponse("text/html", "UTF-8", 200, "OK", mapOf("Cache-Control" to "no-store"),
                        ByteArrayInputStream(documentHtml.toByteArray(Charsets.UTF_8)))
                return WebResourceResponse("text/plain", "UTF-8", 403, "Local resources only", emptyMap(), ByteArrayInputStream(byteArrayOf()))
            }
            override fun onPageFinished(view: WebView, url: String) {
                if (url == ORIGIN) emit(JSONObject().put("type", "ui.init").put("payload", JSONObject()
                    .put("firstRunToken", intent.getStringExtra(EXTRA_FIRST_RUN_TOKEN))))
            }
        }
        setContentView(page)
        OfflineLauncherClient.subscribe(listener)
        loadPage()
        ensureService()
    }

    override fun onResume() { super.onResume(); resumed = true }
    override fun onPause() { resumed = false; super.onPause() }

    /** 只读固定宿主已核验的UI目录；候选不含页面时使用APK基线。 */
    private fun loadPage() {
        val fallback = OfflineLauncherSession.builtinUi(this)
        val selected = OfflineLauncherClient.uiRoot?.let(::File)?.takeIf { root ->
            val path = root.toPath().toAbsolutePath().normalize()
            val owned = path.startsWith(File(filesDir, "aasc-server/updates/code").toPath()) ||
                path.startsWith(File(filesDir, "aasc-launcher-baselines").toPath())
            owned && generateSequence(root) { it.parentFile?.takeIf { parent -> parent.toPath().startsWith(filesDir.toPath()) } }
                .none { Files.isSymbolicLink(it.toPath()) } && File(root, "index.html").isFile && !Files.isSymbolicLink(File(root, "index.html").toPath())
        } ?: fallback
        if (loadedRoot == selected.absolutePath) return
        val document = File(selected, "index.html")
        require(document.length() in 1..(2L * 1024 * 1024)) { "启动器页面大小无效" }
        loadedRoot = selected.absolutePath
        documentHtml = document.readText()
        page.loadUrl(ORIGIN)
    }

    private fun ensureService() {
        ContextCompat.startForegroundService(this, Intent(this, NodeServerService::class.java)
            .putExtra(NodeServerService.EXTRA_MAIN_SERVER_URL, ServerConfig.DEFAULT_OFFLINE_SERVER_URL)
            .putExtra(NodeServerService.EXTRA_OFFLINE_MODE, true))
    }

    private fun emit(value: JSONObject) {
        if (isDestroyed) return
        page.evaluateJavascript("window.dispatchEvent(new CustomEvent('offline-launcher',{detail:${value}}));", null)
    }

    private inner class Bridge {
        @JavascriptInterface
        fun postMessage(raw: String) {
            val request = runCatching { OfflineLauncherProtocol.parse(raw) }.getOrNull() ?: return
            val id = request.optString("requestId")
            if (pending.size >= 32 || !pending.add(id)) return
            val type = request.optString("type")
            val payload = request.optJSONObject("payload") ?: JSONObject()
            workers.execute {
                val response = JSONObject().put("type", "ui.result").put("requestId", id)
                try {
                    val result: Any = when (type) {
                        "native.ensureService" -> { runOnUiThread { ensureService() }; JSONObject() }
                        "native.openDisplay" -> {
                            runOnUiThread {
                                startActivity(Intent(this@OfflineLauncherActivity, MainActivity::class.java)
                                    .putExtra("server_url", ServerConfig.DEFAULT_OFFLINE_SERVER_URL)
                                    .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP))
                                finish()
                            }
                            JSONObject()
                        }
                        "native.installApk" -> {
                            val manager = OfflineUpdateManager(this@OfflineLauncherActivity)
                            val update = manager.checkAndPrepareMinApkUpdate(File(filesDir, "aasc-server"))
                            check(!update.failed && update.apkFile != null) { update.status }
                            val installed = java.util.concurrent.CompletableFuture<Boolean>()
                            runOnUiThread {
                                try {
                                    check(resumed && !isDestroyed && !isFinishing) { "下载已完成，请返回本页再次点击安装" }
                                    installed.complete(manager.installPreparedMinApk(update))
                                } catch (error: Exception) { installed.completeExceptionally(error) }
                            }
                            JSONObject().put("status", if (installed.get(30, java.util.concurrent.TimeUnit.SECONDS))
                                "已请求系统安装" else "请在系统页面允许安装后返回重试")
                        }
                        else -> {
                            require(type in OfflineLauncherProtocol.commands) { "不支持的启动器操作" }
                            if (type == "ui.firstRunShown") check(resumed && !isFinishing) { "页面尚未进入前台" }
                            val reply = OfflineLauncherClient.call(type, payload, if (type == "models.prepareGroup") 3600 else 600)
                            if (type == "ui.firstRunShown") runOnUiThread { intent.removeExtra(EXTRA_FIRST_RUN_TOKEN) }
                            reply
                        }
                    }
                    response.put("result", result)
                } catch (error: Exception) { response.put("error", error.message ?: "操作失败，请重试") }
                finally { pending.remove(id) }
                runOnUiThread { if (!isDestroyed) emit(response) }
            }
        }
    }

    override fun onDestroy() {
        OfflineLauncherClient.unsubscribe(listener)
        if (::page.isInitialized) { page.removeJavascriptInterface("OfflineLauncher"); page.destroy() }
        workers.shutdown()
        super.onDestroy()
    }
}
