package com.aasc.display

import android.content.Context
import android.content.res.AssetManager
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
        private const val STAGING_PREFIX = ".staging-"
    }

    fun ensureInstalled(): File {
        val manifest = readManifest()
        val root = File(context.filesDir, ROOT_NAME)
        val marker = File(root, VERSION_MARKER)
        if (marker.isFile && marker.readText() == manifest.version && isInstalled(root, manifest)) {
            return root
        }

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

    private fun isInstalled(root: File, manifest: NodeRuntimeManifest): Boolean {
        return try {
            manifest.files.all { entry ->
                val file = File(root, mapAssetPath(entry.path))
                file.isFile && file.length() == entry.size && sha256(file) == entry.sha256
            }
        } catch (_: Exception) {
            false
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

    private fun mapAssetPath(assetPath: String): String {
        return if (assetPath.startsWith("server/")) assetPath.removePrefix("server/") else assetPath
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
