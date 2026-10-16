package com.aasc.display

import android.content.Context
import android.os.StatFs
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.nio.file.Files
import java.util.concurrent.CancellationException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean
import java.security.MessageDigest
import org.json.JSONArray
import org.json.JSONObject

internal data class OfflineModelFile(val name: String, val path: String, val size: Long, val sha256: String)
internal data class OfflineModelDefinition(val modelId: String, val revision: String, val files: List<OfflineModelFile>) {
    val totalBytes: Long get() = files.fold(0L) { total, file -> Math.addExact(total, file.size) }
}

/** 构造阶段只查询路径；JS尚未启动时用APK可信目录占位，不能把占位误标为模型就绪。 */
internal object OfflineModelDirectorySnapshot {
    fun resolve(filesRoot: File, modelId: String, states: JSONArray,
        bundledDefinitions: List<OfflineModelDefinition>): File {
        val state = (0 until states.length()).map { states.getJSONObject(it) }
            .firstOrNull { it.optString("modelId") == modelId }
        val reported = state?.optString("directory")?.takeIf { it.isNotBlank() }
        if (reported != null) {
            val directory = File(reported)
            require(directory.isAbsolute && directory.canonicalFile.toPath().startsWith(filesRoot.canonicalFile.toPath())) {
                "JS模型目录不在应用私有目录内"
            }
            return directory
        }
        require(bundledDefinitions.any { it.modelId == modelId }) { "未声明的Offline模型: $modelId" }
        val relative = if (modelId in setOf("sensevoice", "tts", "voiceprint")) "models/$modelId" else "models/llm/$modelId"
        return File(filesRoot, relative)
    }
}

/** Offline 的可信目录与网络缓存；状态读取只比较小元数据和属性，加载前才验证新缓存。 */
class OfflineModelStore(private val context: Context) {
    private val jsManaged get() = OfflineLauncherSession.enabled(context)
    internal val definitions: List<OfflineModelDefinition> get() = if (jsManaged) {
        parseCatalog((OfflineLauncherClient.catalog ?: error("JS模型目录尚未就绪")).toString())
    } else legacyDefinitions
    private val legacyDefinitions by lazy {
        parseCatalog(context.assets.open("offline-model-catalog.json").bufferedReader().use { it.readText() })
    }

    internal fun groups(): List<OfflineModelGroup> {
        if (!jsManaged) return OfflineModelPreparationPlan.groups(definitions)
        val rows = OfflineLauncherClient.catalog?.getJSONArray("groups") ?: error("JS模型分组尚未就绪")
        return (0 until rows.length()).map { index ->
            val row = rows.getJSONObject(index)
            val ids = row.getJSONArray("modelIds")
            OfflineModelGroup(row.getString("id"), row.getString("title"),
                (0 until ids.length()).map { ids.getString(it) }, row.optBoolean("defaultSelected"))
        }
    }

    internal fun prepareGroups(groups: List<OfflineModelGroup>, forceDownload: Boolean,
        cancelled: () -> Boolean, progress: (String, Int) -> Unit, onPrepared: (String) -> Unit) {
        if (!jsManaged) {
            OfflineModelPreparationPlan(definitions, groups).prepare(cancelled, { model, update ->
                prepare(model.modelId, forceDownload || !hasLocalFiles(model.modelId), update)
            }, progress, onPrepared)
            return
        }
        check(!cancelled()) { "已取消模型准备" }
        OfflineLauncherClient.call("models.prepareGroup", JSONObject().put("modelIds", JSONArray(groups.flatMap { it.modelIds }.distinct()))
            .put("allowDownload", forceDownload), 3600) { message ->
            if (!cancelled()) {
                val value = message.optJSONObject("payload") ?: JSONObject()
                val id = value.optString("modelId")
                when (message.optString("type")) {
                    "model.progress" -> progress(id, value.optInt("progress"))
                    "model.prepared" -> { progress(id, value.optInt("progress")); onPrepared(id) }
                }
            }
        }
    }

    private fun state(modelId: String): JSONObject? {
        val rows = OfflineLauncherClient.modelStates
        return (0 until rows.length()).map { rows.getJSONObject(it) }.firstOrNull { it.optString("modelId") == modelId }
    }

    internal fun definition(modelId: String): OfflineModelDefinition = definitions.firstOrNull { it.modelId == modelId }
        ?: error("未声明的 Offline 模型: $modelId")

    fun directoryFor(modelId: String): File {
        if (jsManaged) return OfflineModelDirectorySnapshot.resolve(context.filesDir, modelId, OfflineLauncherClient.modelStates, legacyDefinitions)
        val definition = definition(modelId)
        return candidates(definition).firstOrNull { hasFiles(it, definition) && hasVerificationStamp(it, definition) }
            ?: candidates(definition).firstOrNull { hasFiles(it, definition) } ?: candidates(definition).last()
    }

    fun hasLocalFiles(modelId: String): Boolean = if (jsManaged) state(modelId)?.optBoolean("filesPresent") == true else candidates(definition(modelId)).any { hasFiles(it, definition(modelId)) }

    private fun candidates(model: OfflineModelDefinition): List<File> {
        val voice = model.modelId in setOf("sensevoice", "tts", "voiceprint")
        return if (voice) listOf(File(context.filesDir, "aasc-server/res/models/${model.modelId}"),
            File(context.filesDir, "models/${model.modelId}"))
        else listOf(File(context.filesDir, "models/llm/bundled/${model.modelId}"),
            File(context.filesDir, "models/llm/${model.modelId}"))
    }

    fun requirePrepared(modelId: String): File {
        if (jsManaged) return File(OfflineLauncherClient.objectCall("models.require", JSONObject().put("modelId", modelId)).getString("directory"))
        val model = definition(modelId)
        for (directory in candidates(model).filter { hasFiles(it, model) }
            .sortedByDescending { hasVerificationStamp(it, model) }) {
            try { verifyDirectory(directory, model); return directory }
            catch (_: IllegalArgumentException) { /* 单个坏旧缓存不阻断其他完整缓存。 */ }
        }
        error("模型未就绪或校验失败，请从本机模型入口准备 $modelId")
    }

    private fun verifyDirectory(directory: File, model: OfflineModelDefinition) {
        val marker = File(directory, ".offline-model-verified.json")
        val stamps = JSONArray(model.files.map { file ->
            JSONObject().put("name", file.name).put("size", File(directory, file.name).length())
                .put("mtime", File(directory, file.name).lastModified()).put("sha256", file.sha256)
        })
        val expected = JSONObject().put("modelId", model.modelId).put("revision", model.revision).put("files", stamps)
        if (hasVerificationStamp(directory, model)) return
        require(model.files.all { ModelHash.matches(File(directory, it.name), it.sha256) }) { "本机模型文件摘要不匹配" }
        OfflineBootstrapManager.writeJson(marker, expected)
    }

    fun statusJson(): String = if (jsManaged) OfflineLauncherClient.modelStates.toString() else JSONArray(definitions.map { model ->
        JSONObject().put("modelId", model.modelId).put("revision", model.revision).put("totalBytes", model.totalBytes)
            .put("filesPresent", hasLocalFiles(model.modelId))
            .put("filesReady", candidates(model).any { hasFiles(it, model) && hasVerificationStamp(it, model) })
            .put("downloading", jobs.containsKey(jobKey(model)))
    }).toString()

    /** 同模型下载全局归并；取消令牌覆盖所有等待者，文件集合完整后才切换目录。 */
    fun prepare(modelId: String, allowDownload: Boolean = true, progress: (Int) -> Unit): File {
        if (jsManaged) return File(OfflineLauncherClient.objectCall("models.prepare", JSONObject().put("modelId", modelId)
            .put("allowDownload", allowDownload), 3600) { message ->
            if (message.optString("type") == "model.progress") progress(message.getJSONObject("payload").getInt("progress"))
        }.getString("directory"))
        val model = definition(modelId)
        val key = jobKey(model)
        synchronized(modelLocks.getOrPut(model.modelId) { Any() }) {
            val target = candidates(model).last()
            OfflineModelRecovery.recover(target, model.modelId)
            if (hasLocalFiles(modelId)) {
                try { return requirePrepared(modelId) } catch (_: IllegalStateException) { /* 坏缓存按缺失处理。 */ }
            }
            check(allowDownload) { "本机模型校验失败，需要重新确认下载" }
            val cancel = jobs.getOrPut(key) { AtomicBoolean(false) }
            target.parentFile!!.mkdirs()
            val stage = File(target.parentFile, ".model-${model.modelId}-${System.nanoTime()}")
            check(stage.mkdirs()) { "无法创建模型暂存目录" }
            val backup = File(target.parentFile, ".model-backup-${model.modelId}-${System.nanoTime()}")
            try {
                require(OfflineUpdateManager.hasEnoughSpace(StatFs(target.parentFile!!.path).availableBytes,
                    model.totalBytes, 0, 64L * 1024 * 1024)) { "设备空间不足以准备模型" }
                val source = selectSource(model, cancel)
                var completed = 0L
                for (file in model.files) {
                    checkCancelled(cancel)
                    download(source, file, File(stage, file.name), cancel) { bytes ->
                        progress(((completed + bytes) * 100 / model.totalBytes).toInt().coerceIn(0, 99))
                    }
                    completed += file.size
                }
                if (model.modelId == "sensevoice") model.files.forEach { file ->
                    File(stage, "${file.name}.sha256").writeText(file.sha256 + "\n")
                }
                if (model.modelId == "tts") File(stage, "manifest.json").writeText(JSONArray(model.files.map {
                    JSONObject().put("name", it.name).put("sha256", it.sha256)
                }).toString())
                verifyDirectory(stage, model)
                checkCancelled(cancel)
                if (target.exists()) check(target.renameTo(backup)) { "无法保护旧模型目录" }
                check(stage.renameTo(target)) { "无法提交完整模型目录" }
                // 旧 revision 的目录不在 target 内；LLM 管理器串行切换时再使用新目录。
                backup.deleteRecursively()
                progress(100)
                return target
            } catch (error: Exception) {
                if (backup.exists() && !target.exists()) backup.renameTo(target)
                throw error
            } finally {
                stage.deleteRecursively()
                jobs.remove(key, cancel)
            }
        }
    }

    fun cancel(modelId: String) {
        if (jsManaged) { OfflineLauncherClient.notify("models.cancel", JSONObject().put("modelId", modelId)); return }
        jobs.filterKeys { it.startsWith("${context.filesDir}:$modelId:") }.values.forEach { it.set(true) }
    }

    private fun jobKey(model: OfflineModelDefinition) = "${context.filesDir}:${model.modelId}:${model.revision}"

    private fun selectSource(model: OfflineModelDefinition, cancel: AtomicBoolean): String {
        var lastError: Exception? = null
        for (source in SOURCES) {
            checkCancelled(cancel)
            try {
                val connection = connection(source + "manifest.json")
                val raw = try {
                    require(connection.responseCode == 200) { "模型清单 HTTP ${connection.responseCode}" }
                    connection.inputStream.use { input ->
                        val output = java.io.ByteArrayOutputStream()
                        val buffer = ByteArray(8192)
                        while (true) {
                            checkCancelled(cancel)
                            val count = input.read(buffer)
                            if (count < 0) break
                            require(output.size() + count <= 2 * 1024 * 1024) { "模型清单超过限制" }
                            output.write(buffer, 0, count)
                        }
                        JSONObject(output.toString("UTF-8"))
                    }
                } finally { connection.disconnect() }
                require(raw.optInt("schemaVersion") == 1) { "模型清单格式无效" }
                val rows = raw.getJSONArray("files")
                val files = (0 until rows.length()).map { rows.getJSONObject(it) }
                require(model.files.all { expected -> files.count {
                    it.optString("path") == expected.path && it.optLong("size") == expected.size
                        && it.optString("sha256") == expected.sha256
                } == 1 }) { "此模型尚未完整发布，或文件与 APK 可信定义不一致" }
                return source
            } catch (error: Exception) {
                if (error is CancellationException) throw error
                lastError = error
            }
        }
        throw IllegalStateException("模型源不可用: ${lastError?.message}", lastError)
    }

    private fun download(source: String, file: OfflineModelFile, target: File, cancel: AtomicBoolean, progress: (Long) -> Unit) {
        // 固定同一集合指纹，备用源只提供相同文件，任何超长/截断/错误摘要都不提交。
        var lastError: Exception? = null
        for (base in listOf(source) + SOURCES.filter { it != source }) {
            checkCancelled(cancel)
            val connection = connection(base + file.path)
            try {
                require(connection.responseCode == 200) { "模型文件 HTTP ${connection.responseCode}" }
                val digest = MessageDigest.getInstance("SHA-256")
                var count = 0L
                connection.inputStream.use { input -> FileOutputStream(target).use { output ->
                    val buffer = ByteArray(64 * 1024)
                    while (true) {
                        checkCancelled(cancel)
                        val size = input.read(buffer)
                        if (size < 0) break
                        count += size
                        require(count <= file.size) { "模型长度超过可信定义" }
                        digest.update(buffer, 0, size); output.write(buffer, 0, size); progress(count)
                    }
                    output.fd.sync()
                } }
                require(count == file.size && digest.digest().joinToString("") { "%02x".format(it.toInt() and 255) } == file.sha256) { "模型大小/摘要校验失败" }
                return
            } catch (error: Exception) {
                if (error is CancellationException) throw error
                lastError = error
            } finally { connection.disconnect() }
        }
        throw IllegalStateException("模型下载失败: ${lastError?.message}", lastError)
    }

    private fun connection(url: String): HttpURLConnection {
        requireAllowedSource(url)
        return ModelDownloader.openConnection(url).apply {
            instanceFollowRedirects = false; connectTimeout = 4_000; readTimeout = 12_000
            setRequestProperty("Accept-Encoding", "identity")
        }
    }

    private fun hasVerificationStamp(directory: File, model: OfflineModelDefinition): Boolean = runCatching {
        val marker = JSONObject(File(directory, ".offline-model-verified.json").readText())
        val files = marker.getJSONArray("files")
        marker.optString("modelId") == model.modelId && marker.optString("revision") == model.revision
            && files.length() == model.files.size && model.files.indices.all { index ->
                val expected = model.files[index]
                val actual = files.getJSONObject(index)
                val file = File(directory, expected.name)
                actual.optString("name") == expected.name && actual.optLong("size") == expected.size
                    && file.length() == expected.size && actual.optLong("mtime") == file.lastModified()
                    && actual.optString("sha256") == expected.sha256
            }
    }.getOrDefault(false)

    companion object {
        private val SOURCES = listOf("http://192.168.1.39/mnt/aimodel/", "http://10.221.70.87/mnt/aimodel/", "https://c.aasc.us/mnt/aimodel/")
        private val jobs = ConcurrentHashMap<String, AtomicBoolean>()
        private val modelLocks = ConcurrentHashMap<String, Any>()
        private val safeName = Regex("^[A-Za-z0-9][A-Za-z0-9._-]*$")

        internal fun requireAllowedSource(raw: String) {
            val url = java.net.URI(raw)
            require(url.rawUserInfo == null && url.rawQuery == null && url.rawFragment == null
                && (url.port == -1 || url.port == if (url.scheme == "https") 443 else 80)
                && url.rawPath.startsWith("/mnt/aimodel/")
                && url.rawPath.removePrefix("/mnt/aimodel/").split('/').all { safeName.matches(it) }
                && ((url.scheme == "https" && url.host == "c.aasc.us")
                    || (url.scheme == "http" && url.host in setOf("192.168.1.39", "10.221.70.87")))) { "模型来源不在 Offline 专用范围" }
        }

        internal fun parseCatalog(raw: String): List<OfflineModelDefinition> {
            val root = JSONObject(raw)
            require(root.optInt("schemaVersion") == 1)
            val rows = root.getJSONArray("models")
            val models = (0 until rows.length()).map { index ->
                val model = rows.getJSONObject(index)
                val id = model.getString("modelId")
                require(safeName.matches(id) && model.getString("revision").isNotBlank())
                val files = model.getJSONArray("files")
                val definition = OfflineModelDefinition(id, model.getString("revision"), (0 until files.length()).map { fileIndex ->
                    val file = files.getJSONObject(fileIndex)
                    val name = file.getString("name")
                    val path = file.getString("path")
                    val sha = file.getString("sha256")
                    require(safeName.matches(name) && path.split('/').all { safeName.matches(it) }
                        && path.substringAfterLast('/') == name && file.getLong("size") > 0
                        && Regex("^[a-f0-9]{64}$").matches(sha))
                    OfflineModelFile(name, path, file.getLong("size"), sha)
                })
                require(definition.files.isNotEmpty() && definition.files.map { it.name }.distinct().size == definition.files.size
                    && definition.totalBytes == model.getLong("totalBytes"))
                definition
            }
            require(models.isNotEmpty() && models.map { it.modelId }.distinct().size == models.size)
            return models
        }

        private fun hasFiles(directory: File, model: OfflineModelDefinition): Boolean = !Files.isSymbolicLink(directory.toPath())
            && model.files.all { File(directory, it.name).let { file ->
                file.isFile && !Files.isSymbolicLink(file.toPath()) && file.length() == it.size
            } }

        private fun checkCancelled(cancel: AtomicBoolean) {
            if (cancel.get() || Thread.currentThread().isInterrupted) throw CancellationException("已取消模型准备")
        }

        fun hasBundledModel(context: Context, modelId: String): Boolean = runCatching {
            val metadata = JSONObject(context.assets.open("offline-model-manifest.json").bufferedReader().use { it.readText() })
            val rows = metadata.getJSONArray("models")
            (0 until rows.length()).any { rows.getJSONObject(it).optString("modelId") == modelId }
        }.getOrDefault(false)
    }
}
