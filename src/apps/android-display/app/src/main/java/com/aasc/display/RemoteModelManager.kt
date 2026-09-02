package com.aasc.display

import org.json.JSONArray
import org.json.JSONObject
import java.io.File

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
    val changed: Boolean = false
) {
    fun file(name: String): File = File(directory, name)
}

/**
 * 正式 APK 共用的模型清单下载器：清单决定允许下载的文件，文件 hash 校验通过后才安装。
 * 调用方必须在自己的后台线程执行，避免阻塞 WebView 或音频线程。
 */
class RemoteModelManager {
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
        val parentDirectory = directory.parentFile
        require(parentDirectory != null && (parentDirectory.isDirectory || parentDirectory.mkdirs())) {
            "无法创建模型父目录: ${directory.absolutePath}"
        }
        require(!directory.exists() || directory.isDirectory) { "模型缓存路径不是目录: ${directory.absolutePath}" }
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
            replaceDirectory(stagingDirectory, directory)
            return RemoteModelInstall(model, directory, changed = true)
        } catch (error: Exception) {
            purgeModel(stagingDirectory)
            throw error
        }
    }

    private fun isVerifiedCache(model: RemoteModel, directory: File): Boolean {
        val manifestFile = File(directory, ".manifest.json")
        if (!manifestFile.isFile) return false
        return try {
            val cachedModel = RemoteModelManifest.parse(manifestFile.readText()).requireModel(model.id)
            cachedModel.files == model.files && isComplete(model, directory, verifyHashes = true)
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

    private fun replaceDirectory(stagingDirectory: File, destination: File) {
        val parentDirectory = destination.parentFile ?: error("模型缓存没有父目录")
        val backupDirectory = File(parentDirectory, ".${destination.name}.backup")
        backupDirectory.deleteRecursively()
        val hadDestination = destination.exists()
        val movedOld = !hadDestination || destination.renameTo(backupDirectory)
        check(movedOld) { "无法暂存旧模型目录: ${destination.absolutePath}" }
        try {
            check(stagingDirectory.renameTo(destination)) { "无法安装模型目录: ${destination.absolutePath}" }
        } catch (error: Exception) {
            if (movedOld && backupDirectory.isDirectory) backupDirectory.renameTo(destination)
            throw error
        }
        if (movedOld) backupDirectory.deleteRecursively()
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
