package com.aasc.display

import android.content.Context
import android.content.res.AssetManager
import android.os.SystemClock
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.nio.file.Files
import java.nio.file.Paths
import java.security.MessageDigest
import org.json.JSONObject

class NodeRuntimeInstaller(
    private val context: Context,
    private val assetManager: AssetManager = context.assets
) {

    companion object {
        private const val ASSET_MANIFEST = "runtime-manifest.json"
        private const val ROOT_NAME = "aasc-server"
        private const val VERSION_MARKER = ".runtime-version"
        private const val ASSET_VERSION = "runtime-version.txt"
        private const val ASSET_MODE = "runtime-mode.txt"
        private const val OFFLINE_MODE = "offline"
        private const val OFFLINE_MODEL_METADATA_FILE = "offline-model-manifest.json"
        private const val OFFLINE_CONFIG_SEED_FILE = "offline-config.json"
        private const val RELEASE_CONFIG_SEED_FILE = "release-config.json"
        private const val RELEASE_USER_CONFIG_PREFIX = "release-userconfig"
        private const val TASK_LINKS_MARKER_FILE = "task-links.marker"
        private const val TASK_LATEST_MARKER_FILE = "latest.marker"
        private const val RUNTIME_LIB_DIR = "runtime/arm64-v8a/lib"
        private const val STAGING_PREFIX = ".staging-"
        private const val BACKUP_PREFIX = ".backup-"
        private val MUTABLE_DIRECTORIES = listOf(
            "config",
            "home",
            "logs",
            "res/tasks",
            "res/uploads",
            "res/temp"
        )

        /**
         * 服务重启的快速路径只读取小型版本标记和少量关键文件属性，不解析完整 manifest，
         * 也不读取 Runtime 内容。版本变化或关键文件缺失时由 ensureInstalled() 进入完整
         * manifest 解析、复制和 SHA-256 校验。
         */
        @JvmStatic
        fun canReuseInstalledRuntime(root: File, version: String, mode: String = "online"): Boolean {
            val marker = File(root, VERSION_MARKER)
            return try {
                if (version.isBlank() || !marker.isFile || marker.readText().trim() != version) return false
                val requiredFiles = listOf(
                    File(root, "src/apps/server/boot/server-launcher.js"),
                    File(root, "package.json"),
                    File(root, "package-lock.json")
                )
                requiredFiles.all { it.isFile && it.length() > 0L } &&
                    (mode != OFFLINE_MODE || hasOfflineModels(root)) &&
                    File(root, "config/config.json").isFile &&
                    File(root, RUNTIME_LIB_DIR).listFiles()?.any { it.isFile && it.length() > 0L } == true
            } catch (_: Exception) {
                false
            }
        }

        @JvmStatic
        fun canReuseInstalledRuntime(root: File, manifest: NodeRuntimeManifest): Boolean {
            // 旧版本兼容路径没有 runtime-mode.txt，使用 manifest 中的离线配置种子判断模式，
            // 确保旧 APK 已经解包过模型但尚未生成 config/config.json 时仍会补齐配置。
            val mode = if (manifest.files.any { it.path == OFFLINE_MODEL_METADATA_FILE }) {
                OFFLINE_MODE
            } else {
                "online"
            }
            if (!canReuseInstalledRuntime(root, manifest.version, mode)) return false
            val runtimeEntry = manifest.files.firstOrNull {
                it.path.startsWith("runtime/${manifest.abi}/")
            }
            val requiredEntries = listOfNotNull(
                manifest.files.firstOrNull { it.path == manifest.entrypoint },
                runtimeEntry
            ) + manifest.files.filter { it.path.startsWith("server/res/models/") }
            return requiredEntries.isNotEmpty() && requiredEntries.all { entry ->
                val file = File(root, mapAssetPath(entry.path))
                file.isFile && file.length() == entry.size
            }
        }

        @JvmStatic
        fun shouldSeedTaskDirectory(root: File): Boolean {
            return !File(root, "res/tasks").exists()
        }

        private fun hasOfflineModels(root: File): Boolean {
            val metadataFile = File(root, OFFLINE_MODEL_METADATA_FILE)
            return try {
                val entries = JSONObject(metadataFile.readText()).optJSONArray("files")
                    ?: return false
                if (entries.length() == 0) return false
                val rootPath = root.canonicalFile.toPath()
                for (index in 0 until entries.length()) {
                    val item = entries.optJSONObject(index) ?: return false
                    val relativePath = item.optString("path").trim()
                    val size = item.optLong("size", -1L)
                    if (!relativePath.startsWith("res/models/") || size < 0L) return false
                    val modelFile = File(root, relativePath).canonicalFile
                    if (!modelFile.toPath().startsWith(rootPath) ||
                        !modelFile.isFile ||
                        modelFile.length() != size
                    ) {
                        return false
                    }
                }
                true
            } catch (_: Exception) {
                false
            }
        }

        private fun mapAssetPath(assetPath: String): String {
            return if (assetPath.startsWith("server/")) assetPath.removePrefix("server/") else assetPath
        }
    }

    fun ensureInstalled(): File {
        val startedAt = SystemClock.elapsedRealtime()
        val root = File(context.filesDir, ROOT_NAME)
        val runtimeVersion = readRuntimeVersion()
        val runtimeMode = readRuntimeMode()
        if (runtimeVersion != null && canReuseInstalledRuntime(root, runtimeVersion, runtimeMode)) {
            android.util.Log.i(
                "AASC-Node",
                "Runtime 快速复用，版本=$runtimeVersion，耗时=${SystemClock.elapsedRealtime() - startedAt}ms"
            )
            return root
        }

        // 兼容未携带 runtime-version.txt 的旧 APK；只在这个兼容路径解析一次完整 manifest。
        val manifest = readManifest()
        if (runtimeVersion == null && canReuseInstalledRuntime(root, manifest)) {
            android.util.Log.i(
                "AASC-Node",
                "Runtime 快速复用（旧版本兼容），版本=${manifest.version}，耗时=${SystemClock.elapsedRealtime() - startedAt}ms"
            )
            return root
        }
        android.util.Log.i("AASC-Node", "Runtime 需要完整安装，目标版本=${manifest.version}")
        val staging = File(root.parentFile, "$ROOT_NAME$STAGING_PREFIX${manifest.version}-${System.currentTimeMillis()}")
        if (staging.exists()) staging.deleteRecursively()
        staging.mkdirs()
        try {
            copyManifestFiles(manifest, staging)
            validateInstalledFiles(manifest, staging)
            installCodeFiles(root, staging, manifest.version)
            android.util.Log.i(
                "AASC-Node",
                "Runtime 完整安装完成，版本=${manifest.version}，耗时=${SystemClock.elapsedRealtime() - startedAt}ms"
            )
            return root
        } catch (error: Exception) {
            staging.deleteRecursively()
            throw IllegalStateException("安装 Android Node Runtime 失败: ${error.message}", error)
        }
    }

    private fun readManifest(): NodeRuntimeManifest {
        return try {
            assetManager.open(ASSET_MANIFEST).bufferedReader().use { reader ->
                NodeRuntimeManifest.parse(reader.readText())
            }
        } catch (error: Exception) {
            throw IllegalStateException("读取 Android Node Runtime manifest 失败: ${error.message}", error)
        }
    }

    private fun readRuntimeVersion(): String? {
        return try {
            assetManager.open(ASSET_VERSION).bufferedReader().use { reader ->
                reader.readText().trim().takeIf { it.isNotEmpty() }
            }
        } catch (_: Exception) {
            null
        }
    }

    private fun readRuntimeMode(): String {
        return try {
            assetManager.open(ASSET_MODE).bufferedReader().use { reader ->
                reader.readText().trim().ifEmpty { "online" }
            }
        } catch (_: Exception) {
            "online"
        }
    }

    private fun copyManifestFiles(manifest: NodeRuntimeManifest, staging: File) {
        for (entry in manifest.files) {
            val outputRelativePath = mapAssetPath(entry.path)
            val output = File(staging, outputRelativePath)
            require(output.canonicalFile.toPath().startsWith(staging.canonicalFile.toPath())) {
                "Runtime 文件路径越界: ${entry.path}"
            }
            output.parentFile?.mkdirs()
            assetManager.open(entry.path).use { input ->
                FileOutputStream(output).use { outputStream -> input.copyTo(outputStream) }
            }
            if (entry.path == manifest.nodePath) output.setExecutable(true, true)
        }
    }

    private fun validateInstalledFiles(manifest: NodeRuntimeManifest, staging: File) {
        for (entry in manifest.files) {
            val file = File(staging, mapAssetPath(entry.path))
            require(file.isFile) { "Runtime 文件未安装: ${entry.path}" }
            require(file.length() == entry.size) { "Runtime 文件大小校验失败: ${entry.path}" }
            require(sha256(file) == entry.sha256) { "Runtime 文件 SHA-256 校验失败: ${entry.path}" }
        }
    }

    /**
     * staging 已经完成完整校验后，使用同一父目录内的 rename 直接切换 Runtime。
     *
     * 旧实现把 staging 下的每个代码、依赖和模型目录再次 copy 到 root，模型越大，
     * 首次启动等待越久。这里先把旧 root 改名为 backup，再把 staging 改名为 root，
     * 因此近 1 GB 的 res/models 不再经历 staging 到正式目录的第二次复制。
     * 可变目录在新 Runtime 就位后从 backup 移回，保证升级不会覆盖用户数据。
     */
    private fun installCodeFiles(root: File, staging: File, runtimeVersion: String) {
        val parent = root.parentFile ?: throw IllegalStateException("Runtime 父目录不存在")
        val backup = File(parent, "$ROOT_NAME$BACKUP_PREFIX${System.currentTimeMillis()}")
        var oldRootMoved = false
        val movedMutableDirectories = mutableListOf<String>()
        try {
            if (root.exists()) {
                check(root.renameTo(backup)) { "无法暂存旧 Android Node Runtime 目录" }
                oldRootMoved = true
            }

            check(staging.renameTo(root)) { "无法将已校验 Runtime 目录切换为正式目录" }
            if (oldRootMoved) {
                moveMutableDirectories(backup, root, movedPaths = movedMutableDirectories)
            }
            materializeBundledModelMarkers(root)
            materializeTaskMarkers(root)
            seedFileIfAbsent(root, root, RELEASE_CONFIG_SEED_FILE, "config/config.json")
            seedFileIfAbsent(root, root, OFFLINE_CONFIG_SEED_FILE, "config/config.json")
            seedDirectoryFilesIfAbsent(root, RELEASE_USER_CONFIG_PREFIX, "home/.config/aasc-user")
            preserveMutableDirectories(root)
            removeLegacyNativeVoiceModelCopies(root)
            val marker = File(root, VERSION_MARKER)
            marker.parentFile?.mkdirs()
            marker.writeText(runtimeVersion)

            if (oldRootMoved && backup.exists() && !backup.deleteRecursively()) {
                android.util.Log.w("AASC-Node", "旧 Runtime backup 清理失败: ${backup.absolutePath}")
            }
        } catch (error: Exception) {
            // 新目录安装失败时，把已经移入新目录的用户数据移回 backup，再恢复旧 Runtime。
            if (oldRootMoved && movedMutableDirectories.isNotEmpty()) {
                try {
                    moveMutableDirectories(root, backup, movedMutableDirectories.asReversed())
                } catch (restoreError: Exception) {
                    android.util.Log.e(
                        "AASC-Node",
                        "Runtime 回滚可变目录失败: ${restoreError.message}",
                        restoreError
                    )
                }
            }
            if (root.exists()) root.deleteRecursively()
            if (oldRootMoved && backup.exists() && !backup.renameTo(root)) {
                android.util.Log.e("AASC-Node", "Runtime 回滚失败: 无法恢复旧目录 ${backup.absolutePath}")
            }
            throw error
        }
    }

    /**
     * Android aapt 不携带隐藏 assets；offline 构建将 marker 命名为 bundled-manifest.json，
     * 安装到应用私有目录后恢复服务器和原生模型管理器约定的 .manifest.json。
     * 这里只处理约 1.5 KiB 的 marker，不复制任何模型权重。
     */
    private fun materializeBundledModelMarkers(root: File) {
        val modelRoot = File(root, "res/models/llm")
        modelRoot.listFiles()
            ?.filter { it.isDirectory }
            ?.forEach { modelDirectory ->
                val packagedMarker = File(modelDirectory, "bundled-manifest.json")
                if (packagedMarker.isFile) {
                    packagedMarker.copyTo(
                        File(modelDirectory, ".manifest.json"),
                        overwrite = true
                    )
                }
            }
    }

    /**
     * Android assets 不能保留任务 results/latest 软链接和隐藏任务链文件，构建器把它们
     * 转成 marker。Runtime 切换完成后只在目标不存在时恢复，避免覆盖设备已有任务状态；
     * 服务启动继续由 TaskManager 根据 results/index.json 的 status=running 恢复。
     */
    private fun materializeTaskMarkers(root: File) {
        val tasksRoot = File(root, "res/tasks")
        val taskLinksMarker = File(tasksRoot, TASK_LINKS_MARKER_FILE)
        val taskLinksTarget = File(tasksRoot, ".task-links.json")
        if (taskLinksMarker.isFile) {
            try {
                JSONObject(taskLinksMarker.readText())
                if (!taskLinksTarget.exists()) taskLinksMarker.copyTo(taskLinksTarget)
            } finally {
                taskLinksMarker.delete()
            }
        }

        tasksRoot.listFiles()
            ?.filter { it.isDirectory }
            ?.forEach { taskDirectory ->
                val resultsDirectory = File(taskDirectory, "results")
                val latestMarker = File(resultsDirectory, TASK_LATEST_MARKER_FILE)
                if (!latestMarker.isFile) return@forEach
                try {
                    val instanceId = latestMarker.readText().trim()
                    require(Regex("^[A-Za-z0-9][A-Za-z0-9._-]*$").matches(instanceId)) {
                        "任务 latest 实例 ID 不安全: $instanceId"
                    }
                    val instanceDirectory = File(resultsDirectory, instanceId)
                    val resultsPath = resultsDirectory.canonicalFile.toPath()
                    require(instanceDirectory.canonicalFile.toPath().startsWith(resultsPath)) {
                        "任务 latest 路径越界: $instanceId"
                    }
                    require(instanceDirectory.isDirectory) { "任务 latest 实例不存在: $instanceId" }
                    val latest = File(resultsDirectory, "latest")
                    if (!latest.exists()) {
                        Files.createSymbolicLink(latest.toPath(), Paths.get(instanceId))
                    }
                } finally {
                    latestMarker.delete()
                }
            }
    }

    private fun preserveMutableDirectories(root: File) {
        MUTABLE_DIRECTORIES.forEach { relativePath ->
            File(root, relativePath).mkdirs()
        }
    }

    /**
     * 将旧 Runtime 中的用户目录移动到新 Runtime，移动发生在同一 filesDir 文件系统内，
     * 不会复制目录中的大文件。返回实际移动成功的路径，供异常时按逆序回滚。
     */
    private fun moveMutableDirectories(
        sourceRoot: File,
        targetRoot: File,
        relativePaths: List<String> = MUTABLE_DIRECTORIES,
        movedPaths: MutableList<String> = mutableListOf()
    ): List<String> {
        relativePaths.forEach { relativePath ->
            val source = File(sourceRoot, relativePath)
            if (!source.exists()) return@forEach
            val target = File(targetRoot, relativePath)
            if (target.exists()) target.deleteRecursively()
            target.parentFile?.mkdirs()
            check(source.renameTo(target)) { "无法迁移 Runtime 用户目录: $relativePath" }
            movedPaths += relativePath
        }
        return movedPaths
    }

    /**
     * 离线配置只作为新设备的初始值；已有配置属于用户数据，升级时不能被 APK 资产覆盖。
     */
    private fun seedFileIfAbsent(root: File, staging: File, sourceRelativePath: String, targetRelativePath: String) {
        val target = File(root, targetRelativePath)
        if (target.isFile) return
        val source = File(staging, sourceRelativePath)
        if (!source.isFile) return
        target.parentFile?.mkdirs()
        source.copyTo(target, overwrite = false)
    }

    /**
     * 将发布用户配置作为逐文件种子写入 HOME；文件级判断保证设备已有私有配置不被替换。
     */
    private fun seedDirectoryFilesIfAbsent(root: File, sourceRelativePath: String, targetRelativePath: String) {
        val sourceRoot = File(root, sourceRelativePath)
        if (!sourceRoot.isDirectory) return
        sourceRoot.walkTopDown()
            .filter { it.isFile }
            .forEach { source ->
                val relativePath = source.relativeTo(sourceRoot)
                val target = File(File(root, targetRelativePath), relativePath.path)
                if (!target.exists()) {
                    target.parentFile?.mkdirs()
                    source.copyTo(target, overwrite = false)
                }
            }
    }

    /**
     * 新版 offline 资源已经位于 aasc-server/res/models；只删除明确的旧 ASR/TTS 缓存目录，
     * 不触碰 files/models 下的其他模型或用户文件，避免同一语音模型在设备上保留两份。
     */
    private fun removeLegacyNativeVoiceModelCopies(root: File) {
        val runtimeMode = File(root, "runtime-mode.txt")
        if (!runtimeMode.isFile || runtimeMode.readText().trim() != OFFLINE_MODE) return
        val bundledAsr = File(root, "res/models/sensevoice/model.int8.onnx")
        val bundledTts = File(root, "res/models/tts/manifest.json")
        if (bundledAsr.isFile) File(root, "models/sensevoice").deleteRecursively()
        if (bundledTts.isFile) File(root, "models/tts").deleteRecursively()
    }

    private fun sha256(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        FileInputStream(file).use { input ->
            val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
            while (true) {
                val read = input.read(buffer)
                if (read < 0) break
                digest.update(buffer, 0, read)
            }
        }
        return digest.digest().joinToString("") { byte -> "%02x".format(byte) }
    }
}
