package com.aasc.display

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import androidx.core.app.NotificationCompat
import java.io.File
import java.io.FileInputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.KeyStore
import java.security.cert.CertificateFactory
import org.json.JSONObject
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManagerFactory
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.Executors

class NodeServerService : Service() {

    data class ActiveRelease(
        val codeVersion: Int,
        val dependencyVersion: Int,
        val legacyDependencies: Boolean = false
    )

    companion object {
        const val EXTRA_MAIN_SERVER_URL = "main_server_url"
        const val EXTRA_OFFLINE_MODE = "offline_mode"
        const val EXTRA_APPLY_SERVER_UPDATE = "apply_server_update"
        const val ACTION_STATUS = "com.aasc.display.action.NODE_STATUS"
        const val EXTRA_STATUS = "status"
        const val EXTRA_DETAIL = "detail"
        const val EXTRA_PHASE = "phase"
        const val EXTRA_COMPLETED_BYTES = "completed_bytes"
        const val EXTRA_TOTAL_BYTES = "total_bytes"
        const val STATUS_PREPARING = "preparing"
        const val STATUS_INSTALLING = "installing"
        const val STATUS_STARTING = "starting"
        const val STATUS_FAILED = "failed"
        const val STATUS_SERVICE_UPDATE_APPLYING = "service_update_applying"
        const val STATUS_SERVICE_UPDATE_PROGRESS = "service_update_progress"
        const val STATUS_SERVICE_UPDATE_APPLIED = "service_update_applied"
        const val STATUS_SERVICE_UPDATE_FAILED = "service_update_failed"
        private const val CHANNEL_ID = "aasc_node_server"
        private const val NOTIFICATION_ID = 8081
        private const val MAX_RESTART_ATTEMPTS = 5
        private const val MIN_RETRY_DELAY_MS = 1_000L
        private const val MAX_RETRY_DELAY_MS = 30_000L
        private const val PROCESS_STOP_TIMEOUT_MS = 2_000L
        private const val RELEASE_HEALTH_TIMEOUT_MS = 120_000L
        private const val NODE_LIBRARY_NAME = "libaasc_node.so"

        @JvmStatic
        fun readActiveRelease(rootDir: File): ActiveRelease? {
            val pointer = File(rootDir, "updates/active-release.json")
            if (!pointer.isFile) return null
            val value = JSONObject(pointer.readText())
            val codeVersion = value.optInt("codeVersion", -1)
            val dependencyVersion = value.optInt("dependencyVersion", -1)
            require(codeVersion > 0 && dependencyVersion > 0) {
                "Offline active-release.json 版本字段无效"
            }
            return ActiveRelease(
                codeVersion,
                dependencyVersion,
                value.optBoolean("legacyDependencies", false)
            )
        }

        /**
         * 将旧版本 render-display 结果索引中的随机显示端 ID 迁移到 Offline 专用 ID。
         * 该方法只修改目标任务的 displayId，不触碰其他任务参数或运行状态。
         */
        @JvmStatic
        fun migrateOfflineDisplayTaskIndex(
            indexFile: File,
            fixedDisplayId: String = ServerConfig.OFFLINE_DISPLAY_ID
        ): Boolean {
            if (!indexFile.isFile || fixedDisplayId.isBlank()) return false
            return try {
                val document = JSONObject(indexFile.readText())
                val instances = document.optJSONArray("instances") ?: return false
                var changed = false
                for (index in 0 until instances.length()) {
                    val instance = instances.optJSONObject(index) ?: continue
                    if (instance.optString("taskName") != "render-display") continue
                    val currentDisplayId = instance.optString("displayId").trim()
                    if (currentDisplayId.isEmpty() || currentDisplayId == fixedDisplayId) continue
                    instance.put("displayId", fixedDisplayId)
                    changed = true
                }
                if (!changed) return false
                indexFile.writeText(document.toString(2) + "\n")
                true
            } catch (_: Exception) {
                false
            }
        }

        @JvmStatic
        fun nodeModulesDirectory(rootDir: File, activeRelease: ActiveRelease): File =
            if (activeRelease.legacyDependencies) {
                File(rootDir, "node_modules")
            } else {
                File(rootDir, "updates/dependencies/dependencies-v${activeRelease.dependencyVersion}/node_modules")
            }

        @JvmStatic
        fun buildNodeCommand(
            rootDir: File,
            nativeLibraryDir: File? = null,
            activeRelease: ActiveRelease? = null
        ): List<String> {
            val nodePath = nativeLibraryDir?.let { File(it, NODE_LIBRARY_NAME) }
                ?: File(rootDir, "runtime/arm64-v8a/node")
            val codeRoot = activeRelease?.let {
                File(rootDir, "updates/code/code-v${it.codeVersion}")
            } ?: rootDir
            return listOf(
                nodePath.absolutePath,
                File(codeRoot, "src/apps/server/boot/server-launcher.js").absolutePath,
                "--no-tui"
            )
        }

        @JvmStatic
        fun retryDelayMs(attempt: Int): Long {
            val safeAttempt = attempt.coerceAtLeast(0).coerceAtMost(5)
            return (MIN_RETRY_DELAY_MS shl safeAttempt).coerceAtMost(MAX_RETRY_DELAY_MS)
        }

        @JvmStatic
        fun shouldForceTerminate(processAlive: Boolean): Boolean = processAlive

        @JvmStatic
        fun shouldStartNode(embeddedNode: Boolean): Boolean = embeddedNode

        @JvmStatic
        fun buildNodeEnvironment(
            rootDir: File,
            serverUrl: String,
            serverVersion: String,
            offlineMode: Boolean = false,
            safBaseUrl: String? = null,
            safToken: String? = null,
            androidMediaHome: String? = null,
            nodeModulesDirectory: File? = null,
            apkVersionCode: Int? = null
        ): Map<String, String> {
            val runtimeLibraryPath = File(rootDir, "runtime/arm64-v8a/lib").absolutePath
            val inheritedLibraryPath = System.getenv("LD_LIBRARY_PATH")?.trim().orEmpty()
            val libraryPath = listOf(runtimeLibraryPath, inheritedLibraryPath)
                .filter { it.isNotEmpty() }
                .joinToString(File.pathSeparator)
            val bundledCertificate = File(rootDir, "res/certs/cert.pem")
            val environment = mutableMapOf(
                "HOME" to File(rootDir, "home").absolutePath,
                "LD_LIBRARY_PATH" to libraryPath,
                // Termux Node 默认读取 Termux 私有路径下的 openssl.cnf，APK 无法访问该路径。
                // 使用空配置避免启动阶段因权限错误退出；AASC 节点连接仍显式关闭自签名校验。
                "OPENSSL_CONF" to "/dev/null",
                "AASC_ANDROID_NODE" to "1",
                "AASC_OFFLINE_MODE" to if (offlineMode) "1" else "0",
                "AASC_SERVER_VERSION" to serverVersion,
                "AASC_MAIN_SERVER_URL" to serverUrl,
                "AASC_PROJECT_ROOT" to rootDir.absolutePath
            )
            nodeModulesDirectory?.let {
                environment["NODE_PATH"] = it.absolutePath
                environment["AASC_NODE_MODULES_DIR"] = it.absolutePath
            }
            if (bundledCertificate.isFile) {
                // 证书随 APK 安装到私有目录，只给 Node 子进程增加这一份受信任 CA，
                // 使内部 HTTPS Responses 请求可以校验主服务器自签名证书；不关闭 TLS 校验，
                // 证书缺失时也不注入无效路径，避免非证书构建产生启动告警。
                environment["NODE_EXTRA_CA_CERTS"] = bundledCertificate.absolutePath
            }
            if (!safBaseUrl.isNullOrBlank() && !safToken.isNullOrBlank()) {
                environment["AASC_ANDROID_SAF_URL"] = safBaseUrl
                environment["AASC_ANDROID_SAF_TOKEN"] = safToken
            }
            if (!androidMediaHome.isNullOrBlank()) {
                environment["AASC_ANDROID_MEDIA_HOME"] = androidMediaHome
            }
            if (apkVersionCode != null && apkVersionCode > 0) {
                environment["AASC_APK_VERSION_CODE"] = apkVersionCode.toString()
            }
            return environment
        }
    }

    private val mainHandler = Handler(Looper.getMainLooper())
    private val startExecutor = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "aasc-node-start").apply { isDaemon = true }
    }
    private val restartGeneration = AtomicInteger(0)
    @Volatile
    private var nodeProcess: Process? = null
    private var restartAttempt = 0
    private var mainServerUrl = ""
    private var offlineMode = false
    private var safMediaServer: SafMediaServer? = null
    private val serviceUpdateApplying = java.util.concurrent.atomic.AtomicBoolean(false)

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        startForeground(NOTIFICATION_ID, buildNotification("正在准备 Node.js 服务"))
        try {
            safMediaServer = SafMediaServer(this).also { gateway ->
                val connection = gateway.start()
                android.util.Log.i("AASC-SAF", "SAF 网关已启动: ${connection.baseUrl}")
            }
        } catch (error: Exception) {
            android.util.Log.e("AASC-SAF", "SAF 网关启动失败", error)
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val requestedUrl = intent?.getStringExtra(EXTRA_MAIN_SERVER_URL)?.trim().orEmpty()
        val preferences = getSharedPreferences("aasc_display", MODE_PRIVATE)
        val savedUrl = preferences
            .getString("server_url", "")
            ?.trim()
            .orEmpty()
        val requestedOffline = intent?.takeIf { it.hasExtra(EXTRA_OFFLINE_MODE) }
            ?.getBooleanExtra(EXTRA_OFFLINE_MODE, false)
        val savedOffline = preferences.getBoolean("offline_mode", false)
        val selectedUrl = requestedUrl.ifEmpty { savedUrl }
        val selectedOffline = requestedOffline ?: savedOffline
        val applyServerUpdate = intent?.getBooleanExtra(EXTRA_APPLY_SERVER_UPDATE, false) == true
        if (selectedUrl.isEmpty()) {
            updateNotification("等待配置主服务器地址")
            sendStatus(STATUS_FAILED, "主服务器地址为空")
            return START_STICKY
        }

        if (selectedUrl != mainServerUrl || selectedOffline != offlineMode || nodeProcess?.isAlive != true) {
            mainServerUrl = selectedUrl
            offlineMode = selectedOffline
            preferences
                .edit()
                .putString("server_url", selectedUrl)
                .putBoolean("offline_mode", selectedOffline)
                .apply()
            restartAttempt = 0
            stopNodeProcess()
            enqueueNodeProcessStart(selectedUrl, selectedOffline)
        }
        if (applyServerUpdate && selectedOffline) {
            enqueueConfirmedServiceUpdate()
        }
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        stopNodeProcess()
        safMediaServer?.stop()
        safMediaServer = null
        startExecutor.shutdownNow()
        super.onDestroy()
    }

    /**
     * 通过显式应用内广播通知前台 Activity，避免 Activity 在 Runtime 解包期间只能看到 WebView 错误页。
     * 设置 package 限制接收者，Node 启动细节不会暴露给其他应用。
     */
    private fun sendStatus(
        status: String,
        detail: String? = null,
        phase: String? = null,
        completedBytes: Long? = null,
        totalBytes: Long? = null
    ) {
        val intent = Intent(ACTION_STATUS)
            .setPackage(packageName)
            .putExtra(EXTRA_STATUS, status)
        if (!detail.isNullOrBlank()) {
            intent.putExtra(EXTRA_DETAIL, detail)
        }
        if (!phase.isNullOrBlank()) {
            intent.putExtra(EXTRA_PHASE, phase)
        }
        completedBytes?.let { intent.putExtra(EXTRA_COMPLETED_BYTES, it) }
        totalBytes?.let { intent.putExtra(EXTRA_TOTAL_BYTES, it) }
        sendBroadcast(intent)
    }

    private fun startNodeProcess(serverUrl: String, offlineMode: Boolean) {
        val generation = restartGeneration.incrementAndGet()
        val startAt = SystemClock.elapsedRealtime()
        try {
            sendStatus(STATUS_PREPARING)
            sendStatus(STATUS_INSTALLING)
            val root = NodeRuntimeInstaller(this).ensureInstalled { progress ->
                sendStatus(
                    STATUS_INSTALLING,
                    progress.detail,
                    progress.phase,
                    progress.completedBytes,
                    progress.totalBytes
                )
            }
            val updateManager = if (offlineMode) OfflineUpdateManager(this) else null
            if (offlineMode) {
                if (updateManager?.repairLegacyDependencyPointer(root) == true) {
                    android.util.Log.i("AASC-Node", "Offline active release 已自动切换到已安装的热更依赖")
                }
                val taskIndexPaths = listOf(
                    File(root, "res/tasks/render-display/results/index.json"),
                    File(root, "release/task/render-display/results/index.json")
                )
                taskIndexPaths.forEach { indexFile ->
                    if (migrateOfflineDisplayTaskIndex(indexFile)) {
                        android.util.Log.i("AASC-Node", "Offline render-display 任务已迁移到 ${ServerConfig.OFFLINE_DISPLAY_ID}")
                    }
                }
            }
            val runtimeReadyAt = SystemClock.elapsedRealtime()
            NodeServerConfig.write(
                root,
                serverUrl,
                if (offlineMode) "AASC 显示端 Offline" else "APK-${Build.MODEL}",
                offlineMode = offlineMode
            )
            val activeRelease = readActiveRelease(root)
            val nodeModulesDirectory = activeRelease?.let { nodeModulesDirectory(root, it) }
            val command = buildNodeCommand(root, File(applicationInfo.nativeLibraryDir), activeRelease)
            val processBuilder = ProcessBuilder(command)
                .directory(root)
                .redirectErrorStream(false)
            File(root, "home").mkdirs()
            // Android 负责授予应用专属外部目录访问权限；目录不可用时省略变量，保留内部 HOME 回退。
            val androidMediaHome = getExternalFilesDir(null)?.let { directory ->
                if (!directory.exists()) directory.mkdirs()
                directory.takeIf { it.isDirectory }?.absolutePath
            }
            val safConnection = safMediaServer
                ?.takeIf { SharedStorageAccess.hasPersistedTreeUri(this) }
                ?.connectionInfo()
            processBuilder.environment().putAll(
                buildNodeEnvironment(
                    root,
                    serverUrl,
                    "apk-${readAppVersion()}",
                    offlineMode,
                    safConnection?.baseUrl,
                    safConnection?.token,
                    androidMediaHome,
                    nodeModulesDirectory,
                    readAppVersionCode()
                )
            )
            val process = processBuilder.start()
            nodeProcess = process
            sendStatus(STATUS_STARTING)
            android.util.Log.i(
                "AASC-Node",
                "Node launcher 已启动，工作目录: ${root.absolutePath}，Runtime耗时=${runtimeReadyAt - startAt}ms，总耗时=${SystemClock.elapsedRealtime() - startAt}ms"
            )
            updateNotification(
                if (offlineMode) "Node.js 本地服务运行中" else "Node.js 子服务器运行中，正在连接主服务器"
            )
            if (updateManager?.isReleaseHealthPending(root) == true) {
                monitorPendingRelease(root, process, generation, updateManager)
            }
            readProcessOutput(process, false)
            readProcessOutput(process, true)
            Thread {
                val exitCode = try {
                    process.waitFor()
                } catch (error: InterruptedException) {
                    Thread.currentThread().interrupt()
                    -1
                }
                mainHandler.post {
                    if (generation != restartGeneration.get()) return@post
                    nodeProcess = null
                    android.util.Log.i("AASC-Node", "Node launcher 已退出，退出码: $exitCode")
                    if (exitCode == 0) {
                        updateNotification("Node.js 子服务器已停止")
                    } else {
                        sendStatus(STATUS_FAILED, "Node launcher 退出码: $exitCode")
                        scheduleRestart(generation, exitCode)
                    }
                }
            }.apply {
                name = "aasc-node-wait"
                isDaemon = true
                start()
            }
        } catch (error: Exception) {
            nodeProcess = null
            android.util.Log.e("AASC-Node", "Node launcher 启动失败", error)
            sendStatus(STATUS_FAILED, error.message ?: "未知启动错误")
            updateNotification(
                if (offlineMode) "Node.js 本地服务启动失败：${error.message}"
                else "Node.js 子服务器启动失败：${error.message}"
            )
            scheduleRestart(generation, -1)
        }
    }

    /** 用户在前台确认服务更新后，停止当前 Node 再执行服务包下载和原子切换。 */
    private fun enqueueConfirmedServiceUpdate() {
        if (!serviceUpdateApplying.compareAndSet(false, true)) {
            android.util.Log.i("AASC-Node", "Offline 服务更新已在执行，忽略重复请求")
            return
        }
        startExecutor.execute {
            try {
                val root = NodeRuntimeInstaller(this).ensureInstalled()
                sendStatus(STATUS_SERVICE_UPDATE_APPLYING, "正在停止当前服务并准备更新")
                stopNodeProcess()
                val result = OfflineUpdateManager(this).applyServerUpdate(root) { progress ->
                    sendStatus(
                        STATUS_SERVICE_UPDATE_PROGRESS,
                        progress.detail,
                        progress.phase,
                        progress.completedBytes,
                        progress.totalBytes
                    )
                }
                if (result.applied || result.status == "服务已是当前版本") {
                    sendStatus(STATUS_SERVICE_UPDATE_APPLIED, result.status)
                } else {
                    sendStatus(STATUS_SERVICE_UPDATE_FAILED, result.status)
                }
                restartAttempt = 0
                enqueueNodeProcessStart(mainServerUrl, offlineMode)
            } catch (error: Exception) {
                android.util.Log.e("AASC-Node", "Offline 服务更新执行失败: ${error.message}", error)
                sendStatus(STATUS_SERVICE_UPDATE_FAILED, error.message ?: "服务更新失败")
                enqueueNodeProcessStart(mainServerUrl, offlineMode)
            } finally {
                serviceUpdateApplying.set(false)
            }
        }
    }

    /**
     * 新服务版本只有在本地 HTTP API 真正可用后才提交；超时或进程先退出则回滚指针，
     * 由现有进程监督器重新拉起上一版本。
     */
    private fun monitorPendingRelease(
        root: File,
        process: Process,
        generation: Int,
        updateManager: OfflineUpdateManager
    ) {
        Thread {
            val deadline = SystemClock.elapsedRealtime() + RELEASE_HEALTH_TIMEOUT_MS
            var healthy = false
            while (SystemClock.elapsedRealtime() < deadline && process.isAlive && generation == restartGeneration.get()) {
                if (isLocalServerHealthy(root)) {
                    healthy = true
                    break
                }
                try {
                    Thread.sleep(1_000L)
                } catch (_: InterruptedException) {
                    Thread.currentThread().interrupt()
                    break
                }
            }
            if (healthy) {
                if (updateManager.markCurrentReleaseHealthy(root)) {
                    android.util.Log.i("AASC-Node", "Offline 候选服务已通过健康检查并提交")
                }
                return@Thread
            }
            if (generation == restartGeneration.get() && updateManager.rollbackPendingRelease(root)) {
                android.util.Log.e("AASC-Node", "Offline 候选服务未就绪，已回滚并停止候选进程")
                if (process.isAlive) process.destroyForcibly()
            }
        }.apply {
            name = "aasc-offline-release-health"
            isDaemon = true
            start()
        }
    }

    private fun isLocalServerHealthy(root: File): Boolean {
        val certificateFile = File(root, "res/certs/cert.pem")
        val keyFile = File(root, "res/certs/key.pem")
        val useHttps = certificateFile.isFile && keyFile.isFile
        val endpoint = URL("${if (useHttps) "https" else "http"}://127.0.0.1:8081/api/status")
        val connection = endpoint.openConnection() as HttpURLConnection
        try {
            connection.connectTimeout = 500
            connection.readTimeout = 1_000
            connection.requestMethod = "GET"
            if (connection is HttpsURLConnection) {
                val certificate = FileInputStream(certificateFile).use {
                    CertificateFactory.getInstance("X.509").generateCertificate(it)
                }
                val keyStore = KeyStore.getInstance(KeyStore.getDefaultType()).apply {
                    load(null, null)
                    setCertificateEntry("aasc-local-server", certificate)
                }
                val trustManagers = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm()).apply {
                    init(keyStore)
                }.trustManagers
                connection.sslSocketFactory = SSLContext.getInstance("TLS").apply {
                    init(null, trustManagers, null)
                }.socketFactory
                connection.hostnameVerifier = javax.net.ssl.HostnameVerifier { hostname, _ -> hostname == "127.0.0.1" }
            }
            if (connection.responseCode != 200) return false
            val body = connection.inputStream.bufferedReader().use { it.readText() }
            return runCatching { JSONObject(body).optString("status") == "ok" }.getOrDefault(false)
        } catch (_: Exception) {
            return false
        } finally {
            connection.disconnect()
        }
    }

    private fun readProcessOutput(process: Process, errorStream: Boolean) {
        val stream = if (errorStream) process.errorStream else process.inputStream
        Thread {
            try {
                stream.bufferedReader().useLines { lines ->
                    lines.forEach { line ->
                        val level = if (errorStream) "E" else "I"
                        android.util.Log.println(
                            if (errorStream) android.util.Log.ERROR else android.util.Log.INFO,
                            "AASC-Node",
                            "[$level] $line"
                        )
                    }
                }
            } catch (error: Exception) {
                android.util.Log.w("AASC-Node", "读取 Node 输出失败: ${error.message}")
            }
        }.apply {
            name = if (errorStream) "aasc-node-stderr" else "aasc-node-stdout"
            isDaemon = true
            start()
        }
    }

    private fun scheduleRestart(generation: Int, exitCode: Int) {
        if (generation != restartGeneration.get()) return
        if (restartAttempt >= MAX_RESTART_ATTEMPTS) {
            updateNotification(
                if (offlineMode) "Node.js 本地服务已停止（退出码 $exitCode），请重新启动"
                else "Node.js 子服务器已停止（退出码 $exitCode），请重新启动"
            )
            return
        }
        val delay = retryDelayMs(restartAttempt)
        restartAttempt += 1
        updateNotification(
            if (offlineMode) "Node.js 本地服务退出，${delay}ms 后重试"
            else "Node.js 子服务器退出，${delay}ms 后重试"
        )
        mainHandler.postDelayed({
            if (generation == restartGeneration.get() && nodeProcess == null) {
                enqueueNodeProcessStart(mainServerUrl, offlineMode)
            }
        }, delay)
    }

    private fun enqueueNodeProcessStart(serverUrl: String, offlineMode: Boolean) {
        startExecutor.execute { startNodeProcess(serverUrl, offlineMode) }
    }

    private fun stopNodeProcess() {
        restartGeneration.incrementAndGet()
        mainHandler.removeCallbacksAndMessages(null)
        nodeProcess?.let { process ->
            try {
                process.destroy()
                if (shouldForceTerminate(process.isAlive) &&
                    !process.waitFor(PROCESS_STOP_TIMEOUT_MS, TimeUnit.MILLISECONDS) &&
                    shouldForceTerminate(process.isAlive)) {
                    android.util.Log.w("AASC-Node", "Node launcher 未在超时内退出，执行强制终止")
                    process.destroyForcibly()
                }
            } catch (error: Exception) {
                android.util.Log.w("AASC-Node", "停止 Node launcher 失败: ${error.message}")
            }
        }
        nodeProcess = null
    }

    private fun updateNotification(text: String) {
        val manager = getSystemService(NotificationManager::class.java)
        manager?.notify(NOTIFICATION_ID, buildNotification(text))
    }

    private fun readAppVersion(): String {
        return try {
            @Suppress("DEPRECATION")
            packageManager.getPackageInfo(packageName, 0).versionName ?: "unknown"
        } catch (error: Exception) {
            android.util.Log.w("AASC-Node", "读取 APK 版本失败: ${error.message}")
            "unknown"
        }
    }

    private fun readAppVersionCode(): Int? {
        return try {
            @Suppress("DEPRECATION")
            val info = packageManager.getPackageInfo(packageName, 0)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) info.longVersionCode.toInt() else info.versionCode
        } catch (error: Exception) {
            android.util.Log.w("AASC-Node", "读取 APK versionCode 失败: ${error.message}")
            null
        }
    }

    private fun buildNotification(text: String): Notification {
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_sys_download_done)
            .setContentTitle(getString(R.string.node_service_title))
            .setContentText(text)
            .setOngoing(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val channel = NotificationChannel(
            CHANNEL_ID,
            getString(R.string.node_service_channel),
            NotificationManager.IMPORTANCE_LOW
        )
        getSystemService(NotificationManager::class.java)?.createNotificationChannel(channel)
    }
}
