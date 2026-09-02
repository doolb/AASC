package com.aasc.display

import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.URI

private val SHA256_PATTERN = Regex("[0-9a-fA-F]{64}")

data class RemoteModelFile(
    val name: String,
    val size: Long,
    val sha256: String
)

data class RemoteModel(
    val id: String,
    val files: List<RemoteModelFile>
)

class RemoteModelManifest private constructor(
    val models: List<RemoteModel>
) {
    fun requireModel(modelId: String): RemoteModel = models.firstOrNull { it.id == modelId }
        ?: throw IllegalStateException("服务器未提供模型: $modelId")

    companion object {
        fun parse(raw: String): RemoteModelManifest {
            val root = JSONObject(raw)
            val modelsJson = root.optJSONArray("models")
                ?: throw IllegalStateException("模型清单缺少 models")
            val models = buildList {
                for (modelIndex in 0 until modelsJson.length()) {
                    val modelJson = modelsJson.getJSONObject(modelIndex)
                    val modelId = modelJson.optString("id").trim()
                    require(modelId.isNotEmpty()) { "模型清单包含空模型 ID" }
                    val filesJson = modelJson.optJSONArray("files")
                        ?: throw IllegalStateException("模型 $modelId 缺少 files")
                    val files = parseFiles(modelId, filesJson)
                    require(files.isNotEmpty()) { "模型 $modelId 没有文件" }
                    add(RemoteModel(modelId, files))
                }
            }
            return RemoteModelManifest(models)
        }

        private fun parseFiles(modelId: String, filesJson: JSONArray): List<RemoteModelFile> = buildList {
            for (fileIndex in 0 until filesJson.length()) {
                val fileJson = filesJson.getJSONObject(fileIndex)
                val name = fileJson.optString("name").trim()
                require(name.isNotEmpty() && File(name).name == name) {
                    "模型 $modelId 包含非法文件名"
                }
                val size = fileJson.optLong("size", -1L)
                val sha256 = fileJson.optString("sha256").trim()
                require(size > 0L && SHA256_PATTERN.matches(sha256)) { "模型 $modelId 文件元数据不完整: $name" }
                add(RemoteModelFile(name, size, sha256))
            }
        }
    }
}

data class RemoteModelInstall(
    val model: RemoteModel,
    val directory: File,
    val changed: Boolean = false,
    internal val previousDirectory: File? = null
) {
    fun file(name: String): File = File(directory, name)
}

/**
 * 正式 APK 共用的模型清单下载器：清单决定允许下载的文件，文件 hash 校验通过后才安装。
 * 调用方必须在自己的后台线程执行，避免阻塞 WebView 或音频线程。
 */
class RemoteModelManager {
    private data class FileStamp(val name: String, val size: Long, val modified: Long)
    private val verifiedCaches = mutableMapOf<String, List<FileStamp>>()

    @Synchronized
    fun ensureModel(
        baseUrl: String,
        manifestPath: String,
        downloadPath: String,
        modelId: String,
        directory: File,
        includeModelId: Boolean = true,
        onProgress: (Int) -> Unit = {}
    ): RemoteModelInstall {
        require(baseUrl.isNotBlank()) { "服务器地址为空，无法下载模型" }
        requireSecureBaseUrl(baseUrl)
        val parentDirectory = directory.parentFile
        require(parentDirectory != null && (parentDirectory.isDirectory || parentDirectory.mkdirs())) {
            "无法创建模型父目录: ${directory.absolutePath}"
        }
        require(!directory.exists() || directory.isDirectory) { "模型缓存路径不是目录: ${directory.absolutePath}" }
        recoverPendingInstall(directory)
        val manifestFile = File(directory, ".manifest.json")
        val serverManifestText = ModelDownloader.readText(joinUrl(baseUrl, manifestPath))
        val manifestText = serverManifestText ?: manifestFile.takeIf { it.isFile }?.readText()
            ?: throw IllegalStateException("无法获取模型清单: $manifestPath")
        val manifest = RemoteModelManifest.parse(manifestText)
        val model = manifest.requireModel(modelId)
        if (isVerifiedCache(model, directory)) return RemoteModelInstall(model, directory)

        // 新版本先安装到同级 staging 目录，完整校验后再切换目录，避免更新失败破坏旧缓存。
        val stagingDirectory = File(parentDirectory, ".${directory.name}.staging")
        stagingDirectory.deleteRecursively()
        require(stagingDirectory.mkdirs()) { "无法创建模型临时目录: ${stagingDirectory.absolutePath}" }

        try {
            model.files.forEach { modelFile ->
                val destination = File(stagingDirectory, modelFile.name)
                val relativePath = buildDownloadPath(
                    downloadPath,
                    encodePathSegment(model.id),
                    encodePathSegment(modelFile.name),
                    includeModelId
                )
                val url = joinUrl(baseUrl, relativePath)
                val downloaded = ModelDownloader.download(url, destination, modelFile.sha256, onProgress)
                check(downloaded) { "模型文件下载或 hash 校验失败: ${modelFile.name}" }
            }
            check(isComplete(model, stagingDirectory, verifyHashes = true)) { "模型文件下载后校验失败: ${model.id}" }
            writeAtomically(File(stagingDirectory, ".manifest.json"), manifestText)
            val previousDirectory = replaceDirectory(stagingDirectory, directory)
            markVerifiedCache(model, directory)
            return RemoteModelInstall(model, directory, changed = true, previousDirectory = previousDirectory)
        } catch (error: Exception) {
            purgeModel(stagingDirectory)
            throw error
        }
    }

    /** 新 session 加载成功后删除旧目录；成功前旧目录由 previousDirectory 保留。 */
    @Synchronized
    fun finalizeInstall(install: RemoteModelInstall) {
        install.previousDirectory?.deleteRecursively()
    }

    /** 新模型加载失败时恢复旧目录，确保下一次推理仍可使用上一版完整模型。 */
    @Synchronized
    fun rollbackInstall(install: RemoteModelInstall): RemoteModelInstall? {
        val previousDirectory = install.previousDirectory ?: run {
            install.directory.deleteRecursively()
            verifiedCaches.remove(install.directory.absolutePath)
            return null
        }
        if (!previousDirectory.isDirectory) return null
        val failedDirectory = File(install.directory.parentFile, ".${install.directory.name}.failed")
        failedDirectory.deleteRecursively()
        check(install.directory.renameTo(failedDirectory)) { "无法暂存加载失败的模型目录" }
        try {
            check(previousDirectory.renameTo(install.directory)) { "无法恢复旧模型目录" }
        } catch (error: Exception) {
            failedDirectory.renameTo(install.directory)
            throw error
        }
        failedDirectory.deleteRecursively()
        verifiedCaches.remove(install.directory.absolutePath)
        return RemoteModelInstall(install.model, install.directory)
    }

    private fun isVerifiedCache(model: RemoteModel, directory: File): Boolean {
        val manifestFile = File(directory, ".manifest.json")
        if (!manifestFile.isFile) return false
        return try {
            val cachedModel = RemoteModelManifest.parse(manifestFile.readText()).requireModel(model.id)
            if (cachedModel.files != model.files) return false
            val currentStamp = fileStamp(model, directory)
            if (verifiedCaches[directory.absolutePath] == currentStamp) return true
            if (!isComplete(model, directory, verifyHashes = true)) return false
            verifiedCaches[directory.absolutePath] = currentStamp
            true
        } catch (_: Exception) {
            false
        }
    }

    private fun isComplete(model: RemoteModel, directory: File, verifyHashes: Boolean): Boolean = model.files.all { modelFile ->
        val file = File(directory, modelFile.name)
        file.isFile && file.length() == modelFile.size && file.length() > 0L &&
            (!verifyHashes || ModelHash.matches(file, modelFile.sha256))
    }

    private fun purgeModel(directory: File) {
        // 目录只由本管理器按固定名称创建，清理 staging 不会影响当前有效缓存。
        directory.deleteRecursively()
    }

    private fun recoverPendingInstall(destination: File) {
        val parentDirectory = destination.parentFile ?: return
        val backupDirectory = File(parentDirectory, ".${destination.name}.backup")
        val stagingDirectory = File(parentDirectory, ".${destination.name}.staging")
        stagingDirectory.deleteRecursively()
        if (!backupDirectory.isDirectory) return
        if (!destination.exists()) {
            check(backupDirectory.renameTo(destination)) { "无法恢复未完成的模型安装" }
            return
        }
        val failedDirectory = File(parentDirectory, ".${destination.name}.failed")
        failedDirectory.deleteRecursively()
        check(destination.renameTo(failedDirectory)) { "无法暂存未完成的模型安装" }
        try {
            check(backupDirectory.renameTo(destination)) { "无法恢复未完成的模型安装" }
        } catch (error: Exception) {
            failedDirectory.renameTo(destination)
            throw error
        }
        failedDirectory.deleteRecursively()
        verifiedCaches.remove(destination.absolutePath)
    }

    private fun replaceDirectory(stagingDirectory: File, destination: File): File? {
        val parentDirectory = destination.parentFile ?: error("模型缓存没有父目录")
        val backupDirectory = File(parentDirectory, ".${destination.name}.backup")
        backupDirectory.deleteRecursively()
        if (!destination.exists()) {
            check(stagingDirectory.renameTo(destination)) { "无法安装模型目录: ${destination.absolutePath}" }
            return null
        }
        check(destination.renameTo(backupDirectory)) { "无法暂存旧模型目录: ${destination.absolutePath}" }
        try {
            check(stagingDirectory.renameTo(destination)) { "无法安装模型目录: ${destination.absolutePath}" }
        } catch (error: Exception) {
            if (backupDirectory.isDirectory) backupDirectory.renameTo(destination)
            throw error
        }
        return backupDirectory
    }

    private fun fileStamp(model: RemoteModel, directory: File): List<FileStamp> = model.files.map { modelFile ->
        val file = File(directory, modelFile.name)
        FileStamp(modelFile.name, file.length(), file.lastModified())
    }

    private fun markVerifiedCache(model: RemoteModel, directory: File) {
        verifiedCaches[directory.absolutePath] = fileStamp(model, directory)
    }

    private fun requireSecureBaseUrl(baseUrl: String) {
        val uri = try {
            URI(baseUrl)
        } catch (_: Exception) {
            throw IllegalArgumentException("服务器地址无效: $baseUrl")
        }
        val isHttps = uri.scheme.equals("https", ignoreCase = true)
        val isLoopbackHttp = uri.scheme.equals("http", ignoreCase = true) &&
            uri.host in setOf("127.0.0.1", "localhost", "::1")
        require(isHttps || isLoopbackHttp) { "正式模型下载只允许 HTTPS；HTTP 仅支持本机回环地址" }
    }

    private fun writeAtomically(destination: File, text: String) {
        val temporary = File(destination.parentFile, "${destination.name}.tmp")
        temporary.writeText(text)
        if (!temporary.renameTo(destination)) {
            temporary.copyTo(destination, overwrite = true)
            temporary.delete()
        }
    }

    private fun joinUrl(baseUrl: String, path: String): String =
        "${baseUrl.trimEnd('/')}/${path.trimStart('/')}"

    private fun encodePathSegment(value: String): String =
        java.net.URLEncoder.encode(value, Charsets.UTF_8.name()).replace("+", "%20")

    companion object {
        fun buildDownloadPath(
            downloadPath: String,
            modelId: String,
            fileName: String,
            includeModelId: Boolean = true
        ): String = if (includeModelId) {
            "${downloadPath.trimEnd('/')}/$modelId/$fileName"
        } else {
            "${downloadPath.trimEnd('/')}/$fileName"
        }
    }
}
