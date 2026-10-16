package com.aasc.display

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.widget.Toast
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
    private lateinit var apkInstall: ApkInstallState
    private val mainHandler = Handler(Looper.getMainLooper())
    private val installChanged: () -> Unit = {
        renderApkInstallStatus()
        continueApkInstall()
    }
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
        const val EXTRA_AUTOMATIC = "launcher_automatic"
        const val EXTRA_DEFERRED = "launcher_deferred"
        private const val ORIGIN = OfflineLauncherProtocol.LOCAL_DOCUMENT_URL
        private const val REQ_INSTALL_UNKNOWN_SOURCES = 42
        private const val APK_INSTALL_STATE = "launcher_apk_install"

    }

    /** 仅主线程修改；配置重建共享在途任务，防止旧任务完成后新页面再次提交安装。 */
    private class ApkInstallState {
        var update: MinApkUpdateResult? = null
        var preparing = false
        var submitting = false
        var awaitingApproval = false
        var approvalPaused = false
        var resumePending = false
        var status = ""
        var changed: (() -> Unit)? = null
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(state: Bundle?) {
        // 自动首装和模型提示只借用浮动窗口承载可热更网页，手动管理入口仍使用完整页面。
        val automatic = intent.getBooleanExtra(EXTRA_AUTOMATIC, false) || intent.hasExtra(EXTRA_FIRST_RUN_TOKEN)
        if (automatic) setTheme(androidx.appcompat.R.style.Theme_AppCompat_Dialog)
        super.onCreate(state)
        if (!OfflineLauncherSession.enabled(this)) { finish(); return }
        apkInstall = lastCustomNonConfigurationInstance as? ApkInstallState
            ?: restoreApkInstall(state?.getBundle(APK_INSTALL_STATE))
        apkInstall.changed = installChanged
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
                    .put("automatic", automatic)
                    .put("firstRunQuery", true)
                    .put("firstRunToken", intent.getStringExtra(EXTRA_FIRST_RUN_TOKEN))))
                if (url == ORIGIN) renderApkInstallStatus()
            }
        }
        setContentView(page)
        if (automatic) {
            val screen = resources.displayMetrics
            window.setLayout(minOf((screen.widthPixels * .92).toInt(), (600 * screen.density).toInt()), (screen.heightPixels * .85).toInt())
            setFinishOnTouchOutside(false)
        }
        OfflineLauncherClient.subscribe(listener)
        loadPage()
        ensureService()
    }

    override fun onResume() {
        super.onResume()
        resumed = true
        if (::apkInstall.isInitialized) continueApkInstall()
    }

    override fun onPause() {
        resumed = false
        if (::apkInstall.isInitialized && apkInstall.awaitingApproval) apkInstall.approvalPaused = true
        super.onPause()
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != REQ_INSTALL_UNKNOWN_SOURCES || !::apkInstall.isInitialized) return
        // 厂商设置页的resultCode不可靠，实际权限在恢复前台后重新查询。
        apkInstall.approvalPaused = true
        continueApkInstall()
    }

    @Deprecated("Deprecated in Java")
    override fun onRetainCustomNonConfigurationInstance(): Any? =
        if (::apkInstall.isInitialized) apkInstall else null

    override fun onSaveInstanceState(outState: Bundle) {
        if (::apkInstall.isInitialized) outState.putBundle(APK_INSTALL_STATE, saveApkInstall())
        super.onSaveInstanceState(outState)
    }

    /** 网页请求立即取得当前阶段；用户在系统设置停留多久都不会挂住原RPC。 */
    private fun beginApkInstall(): JSONObject {
        check(resumed && !isDestroyed && !isFinishing) { "请返回本页再次点击安装" }
        if (apkInstall.preparing || apkInstall.submitting || apkInstall.awaitingApproval)
            return JSONObject().put("status", apkInstall.status)
        apkInstall.resumePending = true
        if (apkInstall.update != null) {
            continueApkInstall()
            return JSONObject().put("status", apkInstall.status)
        }
        val operation = apkInstall
        operation.preparing = true
        operation.status = "正在准备并校验安装包"
        renderApkInstallStatus()
        val manager = OfflineUpdateManager(applicationContext)
        val root = File(filesDir, "aasc-server")
        workers.execute {
            val result = try {
                manager.checkAndPrepareMinApkUpdate(root)
            } catch (error: Exception) {
                MinApkUpdateResult(error.message ?: "安装包准备失败", failed = true)
            }
            mainHandler.post {
                operation.preparing = false
                if (result.failed || result.apkFile == null || result.metadata == null) {
                    operation.resumePending = false
                    operation.status = result.status
                } else {
                    operation.update = result
                    operation.status = "安装包已校验，等待前台继续安装"
                }
                // 完成回调交给当前Activity；旧Activity销毁后不再访问其WebView。
                operation.changed?.invoke()
            }
        }
        return JSONObject().put("status", apkInstall.status)
    }

    /** 前台统一消费待办；设置返回、重复resume和RPC点击都不会重复创建安装会话。 */
    private fun continueApkInstall() {
        if (!resumed || isDestroyed || isFinishing || !apkInstall.resumePending) return
        if (apkInstall.preparing || apkInstall.submitting) return
        val update = apkInstall.update ?: return
        val manager = OfflineUpdateManager(applicationContext)
        if (apkInstall.awaitingApproval) {
            if (!apkInstall.approvalPaused) return
            apkInstall.awaitingApproval = false
            apkInstall.approvalPaused = false
            if (manager.requiresUnknownSourcesApproval()) {
                apkInstall.resumePending = false
                apkInstall.status = "未允许此来源安装，请再次点击安装并开启系统开关"
                renderApkInstallStatus()
                Toast.makeText(this, apkInstall.status, Toast.LENGTH_LONG).show()
                return
            }
        }
        if (manager.requiresUnknownSourcesApproval()) {
            // 只有明确点击或刚完成的准备任务会到达这里；拒绝后已关闭resumePending。
            requestApkInstallApproval()
            return
        }
        submitApkInstall(manager, update)
    }

    private fun requestApkInstallApproval() {
        apkInstall.awaitingApproval = true
        apkInstall.approvalPaused = false
        apkInstall.status = "请开启“允许此来源安装”，返回后将自动继续安装"
        renderApkInstallStatus()
        try {
            startActivityForResult(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES)
                .setData(Uri.parse("package:$packageName")), REQ_INSTALL_UNKNOWN_SOURCES)
        } catch (error: Exception) {
            apkInstall.awaitingApproval = false
            apkInstall.resumePending = false
            apkInstall.status = "无法打开安装权限设置：${error.message}，请稍后重试"
            renderApkInstallStatus()
            Toast.makeText(this, apkInstall.status, Toast.LENGTH_LONG).show()
        }
    }

    /** 哈希、包身份检查及会话写入留在后台；提交前消费待办，系统确认始终由用户操作。 */
    private fun submitApkInstall(manager: OfflineUpdateManager, update: MinApkUpdateResult) {
        val operation = apkInstall
        operation.update = null
        operation.resumePending = false
        operation.submitting = true
        operation.status = "正在提交系统安装"
        renderApkInstallStatus()
        workers.execute {
            val failure = try {
                if (manager.installPreparedMinApk(update)) null else "安装权限已关闭，请重试并允许此来源安装"
            } catch (error: Exception) { error.message ?: "安装提交失败" }
            mainHandler.post {
                operation.submitting = false
                operation.status = if (failure == null) "已请求系统安装，请在系统提示中确认"
                    else "未能提交安装：$failure"
                if (failure != null) operation.update = update
                operation.changed?.invoke()
            }
        }
    }

    private fun renderApkInstallStatus() {
        if (!::page.isInitialized || isDestroyed || !::apkInstall.isInitialized || apkInstall.status.isBlank()) return
        emit(JSONObject().put("type", "apk.installStatus").put("payload", JSONObject().put("status", apkInstall.status)))
    }

    /** 系统Bundle只存本次用户已选择包的身份；恢复后仍走安装器的缓存路径、SHA和签名验证。 */
    private fun saveApkInstall(): Bundle = Bundle().apply {
        putString("status", apkInstall.status)
        putBoolean("busy", apkInstall.preparing || apkInstall.submitting)
        putBoolean("resumePending", apkInstall.resumePending)
        putBoolean("awaitingApproval", apkInstall.awaitingApproval)
        val update = apkInstall.update ?: return@apply
        val metadata = update.metadata ?: return@apply
        putString("path", update.apkFile?.absolutePath)
        putInt("versionCode", metadata.versionCode)
        putString("versionName", metadata.versionName)
        putString("relativeUrl", metadata.artifact.relativeUrl)
        putLong("size", metadata.artifact.size)
        putString("sha256", metadata.artifact.sha256)
        putString("packageName", metadata.packageName)
        putString("signerSha256", metadata.signerSha256)
        putString("modelCompatibilitySha256", metadata.modelCompatibilitySha256)
    }

    private fun restoreApkInstall(saved: Bundle?): ApkInstallState = ApkInstallState().apply {
        if (saved == null) return@apply
        status = saved.getString("status").orEmpty()
        if (saved.getBoolean("busy")) {
            status = "上次安装任务已中断，请点击安装重试"
            return@apply
        }
        try {
            val path = saved.getString("path") ?: return@apply
            val version = saved.getInt("versionCode")
            val metadata = OfflineMinApkArtifact(version, requireNotNull(saved.getString("versionName")),
                OfflineUpdateArtifact(version, requireNotNull(saved.getString("relativeUrl")), saved.getLong("size"),
                    requireNotNull(saved.getString("sha256"))), requireNotNull(saved.getString("packageName")),
                requireNotNull(saved.getString("signerSha256")), requireNotNull(saved.getString("modelCompatibilitySha256")))
            update = MinApkUpdateResult("恢复待安装APK", File(path), metadata)
            resumePending = saved.getBoolean("resumePending")
            awaitingApproval = saved.getBoolean("awaitingApproval")
            approvalPaused = awaitingApproval
        } catch (_: Exception) {
            status = "无法恢复待安装任务，请点击安装重试"
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (intent.getBooleanExtra(EXTRA_AUTOMATIC, false) || intent.hasExtra(EXTRA_FIRST_RUN_TOKEN)) {
            page.evaluateJavascript("window.dispatchEvent(new Event('launcher-back'));", null)
            return
        }
        super.onBackPressed()
    }

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
                                    .putExtra(EXTRA_DEFERRED, payload.optBoolean("deferred"))
                                    .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP))
                                finish()
                            }
                            JSONObject()
                        }
                        "native.installApk" -> {
                            val accepted = java.util.concurrent.CompletableFuture<JSONObject>()
                            runOnUiThread {
                                try {
                                    accepted.complete(beginApkInstall())
                                } catch (error: Exception) { accepted.completeExceptionally(error) }
                            }
                            accepted.get(30, java.util.concurrent.TimeUnit.SECONDS)
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
        if (::apkInstall.isInitialized && apkInstall.changed === installChanged) apkInstall.changed = null
        if (::page.isInitialized) { page.removeJavascriptInterface("OfflineLauncher"); page.destroy() }
        workers.shutdown()
        super.onDestroy()
    }
}
