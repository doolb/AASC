package com.aasc.display

import android.content.Context
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.nio.file.Files
import java.nio.file.StandardCopyOption.ATOMIC_MOVE
import java.nio.file.StandardCopyOption.REPLACE_EXISTING
import java.util.concurrent.TimeUnit

/** APK固定宿主只物化可信基线/Runtime并连接管道；下载与组合更新均由JS负责。 */
internal class OfflineLauncherSession(private val context: Context,
    private val status: (String, String?, String?, Long?, Long?) -> Unit) {
    val generation = java.util.UUID.randomUUID().toString()
    @Volatile var ready = false
    @Volatile private var process: Process? = null
    @Volatile private var closing = false
    private val writeLock = Any()
    val alive get() = process?.isAlive == true

    companion object {
        fun builtinUi(context: Context): File = File(OfflineLauncherSession(context) { _, _, _, _, _ -> }.installBaseline(), "src/apps/server/boot/offline-launcher/ui")
        const val ASSET_MANIFEST = "offline-launcher-manifest.json"
        fun enabled(context: Context): Boolean = context.resources.getBoolean(R.bool.aasc_offline_mode) &&
            runCatching { context.assets.open(ASSET_MANIFEST).use { true } }.getOrDefault(false)
    }

    private fun safe(root: File, relative: String): File {
        require(relative.isNotBlank() && relative.split('/').all { it.isNotEmpty() && it != "." && it != ".." && !it.contains('\\') && !it.contains(':') }) { "启动器资产路径无效" }
        var current = root
        require(!Files.isSymbolicLink(current.toPath())) { "启动器根不能为链接" }
        relative.split('/').forEach { part -> current = File(current, part); require(!Files.isSymbolicLink(current.toPath())) { "启动器路径不能为链接" } }
        return current
    }

    private fun installBaseline(): File {
        val manifest = JSONObject(context.assets.open(ASSET_MANIFEST).bufferedReader().use { it.readText() })
        require(manifest.optInt("schemaVersion") == 1 && manifest.optInt("hostApi") == 1 && manifest.optInt("stateApi") == 1)
        val id = manifest.getString("id")
        require(Regex("^[a-f0-9]{64}$").matches(id))
        val root = safe(context.filesDir, "aasc-launcher-baselines/$id")
        root.mkdirs()
        val entries = manifest.getJSONArray("files")
        require(entries.length() in 1..256)
        val names = mutableSetOf<String>()
        for (index in 0 until entries.length()) {
            val entry = entries.getJSONObject(index)
            val name = entry.getString("path")
            require(names.add(name) && entry.getLong("size") in 1..(4L * 1024 * 1024))
            val target = safe(root, name)
            val sha = entry.getString("sha256")
            if (target.isFile && target.length() == entry.getLong("size") && ModelHash.matches(target, sha)) continue
            target.parentFile!!.mkdirs()
            val temporary = safe(root, "$name.tmp")
            context.assets.open("offline-launcher/$name").use { input -> FileOutputStream(temporary).use { output -> input.copyTo(output); output.fd.sync() } }
            require(temporary.length() == entry.getLong("size") && ModelHash.matches(temporary, sha)) { "内置启动器资产校验失败" }
            Files.move(temporary.toPath(), target.toPath(), ATOMIC_MOVE, REPLACE_EXISTING)
        }
        require("src/apps/server/boot/offline-launcher/supervisor.js" in names)
        return root
    }

    fun start(serverUrl: String, versionName: String, versionCode: Int, safUrl: String?, safToken: String?) {
        val bundle = installBaseline()
        val root = NodeRuntimeInstaller(context).ensureLauncherRuntime()
        val fullPending = OfflineFullApkActivation.isPending(root)
        val launcherPointer = File(root, "updates/launcher-state.json")
        val previousLauncher = File(root, "updates/full-apk-launcher-state.json")
        if (fullPending && launcherPointer.isFile && !previousLauncher.exists()) {
            require(launcherPointer.renameTo(previousLauncher)) { "无法暂存整包切换前的JS启动器状态" }
        }
        val environment = NodeServerService.buildNodeEnvironment(root, serverUrl, "apk-$versionName", true,
            safUrl, safToken, context.getExternalFilesDir(null)?.absolutePath, null, versionCode, null)
        val config = JSONObject().put("hostApi", 1).put("stateApi", 1).put("root", root.absolutePath)
            .put("bundleRoot", bundle.absolutePath).put("generation", generation).put("apkVersion", versionCode)
            .put("updateOnly", context.resources.getBoolean(R.bool.aasc_update_only_mode))
            .put("environment", JSONObject(environment)).put("publicKey", context.assets.open(OfflineUpdateManager.PUBLIC_KEY_ASSET).bufferedReader().use { it.readText() })
        val configFile = File(root, "launcher-host.json")
        OfflineBootstrapManager.writeJson(configFile, config)
        val command = listOf(File(context.applicationInfo.nativeLibraryDir, "libaasc_node.so").absolutePath,
            File(bundle, "src/apps/server/boot/offline-launcher/supervisor.js").absolutePath, configFile.absolutePath)
        val builder = ProcessBuilder(command).directory(root)
        builder.environment().putAll(environment)
        File(root, "home").mkdirs()
        val child = builder.start()
        process = child
        OfflineLauncherClient.attach(this)
        Thread({
            try {
                child.inputStream.bufferedReader().useLines { lines -> lines.forEach { line ->
                    require(line.toByteArray().size <= 2 * 1024 * 1024) { "启动器消息超限" }
                    val message = JSONObject(line)
                    OfflineLauncherClient.receive(this, message)
                    val payload = message.optJSONObject("payload") ?: JSONObject()
                    when (message.optString("type")) {
                        "launcher.fatal" -> { ready = false; child.outputStream.close() }
                        "startup.status", "service.result" -> {
                            val state = payload.optString("status")
                            if (state == "ready" && fullPending) {
                                runCatching { OfflineFullApkActivation.markHealthyAndCleanup(root); previousLauncher.delete() }.onFailure { android.util.Log.w("AASC-JS-Launcher", "整包健康后的清理待重试", it) }
                            }
                            if (state == "failed" && OfflineFullApkActivation.rollbackPending(root)) {
                                if (previousLauncher.isFile && !launcherPointer.exists()) previousLauncher.renameTo(launcherPointer)
                                OfflineLauncherClient.notify("service.restart")
                            }
                            status(state, payload.optString("detail").takeIf { it.isNotEmpty() }, payload.optString("phase").takeIf { it.isNotEmpty() }, null, null)
                        }
                        "update.progress" -> if (payload.optString("phase") != "downloading_apk") status(
                            if (payload.optBoolean("bootstrap")) NodeServerService.STATUS_INSTALLING else NodeServerService.STATUS_SERVICE_UPDATE_PROGRESS,
                            payload.optString("detail"), payload.optString("phase"), payload.optLong("completedBytes"), payload.optLong("totalBytes"))
                    }
                } }
            } catch (error: Exception) { if (!closing) { child.destroy(); status("failed", error.message, null, null, null) } }
            finally { ready = false; OfflineLauncherClient.detach(this) }
        }, "aasc-js-protocol").apply { isDaemon = true; start() }
        Thread({ child.errorStream.bufferedReader().useLines { lines -> lines.forEach { android.util.Log.i("AASC-Node", it) } } }, "aasc-js-log").apply { isDaemon = true; start() }
        Thread({
            val code = child.waitFor()
            ready = false; OfflineLauncherClient.detach(this)
            if (!closing) status("failed", "JS启动器进程已退出: $code", null, null, null)
        }, "aasc-js-exit").apply { isDaemon = true; start() }
    }

    fun write(message: JSONObject) = synchronized(writeLock) {
        val bytes = (message.toString() + "\n").toByteArray()
        require(bytes.size <= 2 * 1024 * 1024)
        val child = process ?: error("启动器未连接")
        child.outputStream.write(bytes); child.outputStream.flush()
    }

    fun close() {
        closing = true
        val child = process ?: return
        ready = false
        OfflineLauncherClient.detach(this)
        runCatching { child.outputStream.close() }
        if (!child.waitFor(20, TimeUnit.SECONDS)) child.destroyForcibly()
        process = null
    }
}
