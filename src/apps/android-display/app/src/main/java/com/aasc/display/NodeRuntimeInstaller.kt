package com.aasc.display

import android.content.Context
import android.content.res.AssetManager
import android.os.SystemClock
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.security.MessageDigest

class NodeRuntimeInstaller(
    private val context: Context,
    private val assetManager: AssetManager = context.assets
) {

    companion object {
        private const val ASSET_MANIFEST = "runtime-manifest.json"
        private const val ROOT_NAME = "aasc-server"
        private const val VERSION_MARKER = ".runtime-version"
        private const val ASSET_VERSION = "runtime-version.txt"
        private const val RUNTIME_LIB_DIR = "runtime/arm64-v8a/lib"
        private const val STAGING_PREFIX = ".staging-"

        /**
         * 服务重启的快速路径只读取小型版本标记和少量关键文件属性，不解析完整 manifest，
         * 也不读取 Runtime 内容。版本变化或关键文件缺失时由 ensureInstalled() 进入完整
         * manifest 解析、复制和 SHA-256 校验。
         */
        @JvmStatic
        fun canReuseInstalledRuntime(root: File, version: String): Boolean {
            val marker = File(root, VERSION_MARKER)
            return try {
                if (version.isBlank() || !marker.isFile || marker.readText().trim() != version) return false
                val requiredFiles = listOf(
                    File(root, "src/apps/server/boot/server-launcher.js"),
                    File(root, "package.json"),
                    File(root, "package-lock.json")
                )
                requiredFiles.all { it.isFile && it.length() > 0L } &&
                    File(root, RUNTIME_LIB_DIR).listFiles()?.any { it.isFile && it.length() > 0L } == true
            } catch (_: Exception) {
                false
            }
        }

        @JvmStatic
        fun canReuseInstalledRuntime(root: File, manifest: NodeRuntimeManifest): Boolean {
            if (!canReuseInstalledRuntime(root, manifest.version)) return false
            val runtimeEntry = manifest.files.firstOrNull {
                it.path.startsWith("runtime/${manifest.abi}/")
            }
            val requiredEntries = listOfNotNull(
                manifest.files.firstOrNull { it.path == manifest.entrypoint },
                runtimeEntry
            )
            return requiredEntries.isNotEmpty() && requiredEntries.all { entry ->
                val file = File(root, mapAssetPath(entry.path))
                file.isFile && file.length() == entry.size
            }
        }

        private fun mapAssetPath(assetPath: String): String {
            return if (assetPath.startsWith("server/")) assetPath.removePrefix("server/") else assetPath
        }
    }

    fun ensureInstalled(): File {
        val startedAt = SystemClock.elapsedRealtime()
        val root = File(context.filesDir, ROOT_NAME)
        val marker = File(root, VERSION_MARKER)
        val runtimeVersion = readRuntimeVersion()
        if (runtimeVersion != null && canReuseInstalledRuntime(root, runtimeVersion)) {
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
            installCodeFiles(root, staging)
            preserveMutableDirectories(root)
            marker.parentFile?.mkdirs()
            marker.writeText(manifest.version)
            staging.deleteRecursively()
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

    private fun installCodeFiles(root: File, staging: File) {
        root.mkdirs()
        replaceDirectory(root, staging, "runtime")
        replaceDirectory(root, staging, "src")
        replaceDirectory(root, staging, "node_modules")
        replaceFile(root, staging, "package.json")
        replaceFile(root, staging, "package-lock.json")
        replaceDirectory(root, staging, "res/certs")
    }

    private fun preserveMutableDirectories(root: File) {
        listOf("config", "res/uploads", "res/temp", "logs").forEach { relativePath ->
            File(root, relativePath).mkdirs()
        }
    }

    private fun replaceDirectory(root: File, staging: File, relativePath: String) {
        val source = File(staging, relativePath)
        if (!source.exists()) return
        val target = File(root, relativePath)
        if (target.exists()) target.deleteRecursively()
        source.copyRecursively(target, overwrite = true)
    }

    private fun replaceFile(root: File, staging: File, relativePath: String) {
        val source = File(staging, relativePath)
        if (!source.isFile) return
        val target = File(root, relativePath)
        target.parentFile?.mkdirs()
        source.copyTo(target, overwrite = true)
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
