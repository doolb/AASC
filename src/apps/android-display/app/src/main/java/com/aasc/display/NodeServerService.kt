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
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.Executors

class NodeServerService : Service() {

    companion object {
        const val EXTRA_MAIN_SERVER_URL = "main_server_url"
        const val EXTRA_OFFLINE_MODE = "offline_mode"
        private const val CHANNEL_ID = "aasc_node_server"
        private const val NOTIFICATION_ID = 8081
        private const val MAX_RESTART_ATTEMPTS = 5
        private const val MIN_RETRY_DELAY_MS = 1_000L
        private const val MAX_RETRY_DELAY_MS = 30_000L
        private const val PROCESS_STOP_TIMEOUT_MS = 2_000L
        private const val NODE_LIBRARY_NAME = "libaasc_node.so"

        @JvmStatic
        fun buildNodeCommand(rootDir: File, nativeLibraryDir: File? = null): List<String> {
            val nodePath = nativeLibraryDir?.let { File(it, NODE_LIBRARY_NAME) }
                ?: File(rootDir, "runtime/arm64-v8a/node")
            return listOf(
                nodePath.absolutePath,
                File(rootDir, "src/apps/server/boot/server-launcher.js").absolutePath,
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
        fun buildNodeEnvironment(
            rootDir: File,
            serverUrl: String,
            serverVersion: String,
            offlineMode: Boolean = false
        ): Map<String, String> {
            val runtimeLibraryPath = File(rootDir, "runtime/arm64-v8a/lib").absolutePath
            val inheritedLibraryPath = System.getenv("LD_LIBRARY_PATH")?.trim().orEmpty()
            val libraryPath = listOf(runtimeLibraryPath, inheritedLibraryPath)
                .filter { it.isNotEmpty() }
                .joinToString(File.pathSeparator)
            return mapOf(
                "HOME" to File(rootDir, "home").absolutePath,
                "LD_LIBRARY_PATH" to libraryPath,
                // Termux Node 默认读取 Termux 私有路径下的 openssl.cnf，APK 无法访问该路径。
                // 使用空配置避免启动阶段因权限错误退出；AASC 节点连接仍显式关闭自签名校验。
                "OPENSSL_CONF" to "/dev/null",
                "AASC_ANDROID_NODE" to "1",
                "AASC_OFFLINE_MODE" to if (offlineMode) "1" else "0",
                "AASC_SERVER_VERSION" to serverVersion,
                "AASC_MAIN_SERVER_URL" to serverUrl
            )
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

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        startForeground(NOTIFICATION_ID, buildNotification("正在准备 Node.js 服务"))
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
        if (selectedUrl.isEmpty()) {
            updateNotification("等待配置主服务器地址")
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
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        stopNodeProcess()
        startExecutor.shutdownNow()
        super.onDestroy()
    }

    private fun startNodeProcess(serverUrl: String, offlineMode: Boolean) {
        val generation = restartGeneration.incrementAndGet()
        val startAt = SystemClock.elapsedRealtime()
        try {
            val root = NodeRuntimeInstaller(this).ensureInstalled()
            val runtimeReadyAt = SystemClock.elapsedRealtime()
            NodeServerConfig.write(
                root,
                serverUrl,
                if (offlineMode) "AASC 显示端 Offline" else "APK-${Build.MODEL}",
                offlineMode = offlineMode
            )
            val command = buildNodeCommand(root, File(applicationInfo.nativeLibraryDir))
            val processBuilder = ProcessBuilder(command)
                .directory(root)
                .redirectErrorStream(false)
            File(root, "home").mkdirs()
            processBuilder.environment().putAll(
                buildNodeEnvironment(root, serverUrl, "apk-${readAppVersion()}", offlineMode)
            )
            val process = processBuilder.start()
            nodeProcess = process
            android.util.Log.i(
                "AASC-Node",
                "Node launcher 已启动，工作目录: ${root.absolutePath}，Runtime耗时=${runtimeReadyAt - startAt}ms，总耗时=${SystemClock.elapsedRealtime() - startAt}ms"
            )
            updateNotification(
                if (offlineMode) "Node.js 本地服务运行中" else "Node.js 子服务器运行中，正在连接主服务器"
            )
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
            updateNotification(
                if (offlineMode) "Node.js 本地服务启动失败：${error.message}"
                else "Node.js 子服务器启动失败：${error.message}"
            )
            scheduleRestart(generation, -1)
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
