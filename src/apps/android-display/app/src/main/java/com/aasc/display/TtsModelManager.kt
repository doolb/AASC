package com.aasc.display

import android.content.Context
import android.os.Handler
import android.os.Looper
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

// TTS 嵌入式模型管理：下载/校验/加载/状态机（镜像 AsrModelManager，模型清单从服务器 manifest 获取）
// 状态：not_ready → downloading → ready | error（error 或损坏后再次 ensureModel 会重新下载）
class TtsModelManager(
    private val context: Context,
    private val uiHandler: Handler = Handler(Looper.getMainLooper())
) {
    private val modelDir = File(context.filesDir, "models/tts")
    // 本地已验证 hash 记录（重启时只比较记录与服务器 manifest，不重新读取大文件计算 hash）
    private val localHashFile = File(modelDir, "hashes.json")
    private val downloadPool: ExecutorService = Executors.newSingleThreadExecutor()
    private val lock = Any()

    @Volatile var state: String = "not_ready"; private set
    @Volatile var progress: Int = 0; private set
    @Volatile var lastError: String = ""; private set

    val isReady: Boolean get() = state == "ready"
    val modelDirPath: String get() = modelDir.absolutePath

    fun statusJson(): JSONObject = JSONObject()
        .put("state", state)
        .put("progress", progress)
        .put("error", lastError)

    // 幂等触发：ready 返回 "ready"；downloading 返回 "downloading"；否则启动下载返回 "downloading"
    fun ensureModel(baseUrl: String, onModelEvent: (JSONObject) -> Unit): String {
        synchronized(lock) {
            if (state == "ready") return "ready"
            if (state == "downloading") return "downloading"
            state = "downloading"
            progress = 0
            lastError = ""
        }
        postModelEvent(JSONObject().put("state", "downloading").put("progress", 0), onModelEvent)
        downloadPool.execute {
            try {
                modelDir.mkdirs()
                val manifestUrl = "$baseUrl/api/tts/model-manifest"
                val manifest = fetchManifest(manifestUrl)
                if (manifest == null) {
                    state = "error"
                    lastError = "无法获取模型清单"
                    purgeModelFiles()
                    postModelEvent(JSONObject().put("state", "error").put("error", lastError), onModelEvent)
                    return@execute
                }
                // 重启时：本地 hashes.json 与服务器 manifest 完全一致 → 跳过下载
                val localHashes = readLocalHashes()
                val allVerified = manifest.all { entry ->
                    val f = File(modelDir, entry.name)
                    f.isFile && localHashes[entry.name] == entry.sha256
                }
                if (allVerified) {
                    val memOk = hasEnoughMemory()
                    val loadOk = memOk && TtsEngine.load(context, modelDir)
                    if (loadOk) {
                        state = "ready"
                        postModelEvent(JSONObject().put("state", "ready"), onModelEvent)
                    } else {
                        state = "error"
                        lastError = if (!memOk) "设备内存不足，无法加载语音模型" else "模型加载自检失败"
                        postModelEvent(JSONObject().put("state", "error").put("error", lastError), onModelEvent)
                    }
                    return@execute
                }
                // 逐文件下载并校验 hash（按预估总量计算全局进度）
                val estimatedTotal = 75L * 1024 * 1024
                var downloadedBytes = 0L
                val verifiedHashes = mutableMapOf<String, String>()
                var allOk = true
                for (entry in manifest) {
                    val dest = File(modelDir, entry.name)
                    if (dest.isFile && localHashes[entry.name] == entry.sha256) {
                        verifiedHashes[entry.name] = entry.sha256
                        downloadedBytes += dest.length()
                        continue
                    }
                    val fileUrl = "$baseUrl/api/tts/model/${entry.name}"
                    val ok = ModelDownloader.download(fileUrl, dest, entry.sha256) { p ->
                        val globalProgress = ((downloadedBytes + p.toLong() * dest.length() / 100) * 100 / estimatedTotal).toInt()
                        progress = globalProgress.coerceIn(0, 99)
                        postModelEvent(JSONObject().put("state", "downloading").put("progress", progress), onModelEvent)
                    }
                    if (!ok) {
                        allOk = false
                        lastError = "模型文件下载失败: ${entry.name}"
                        break
                    }
                    verifiedHashes[entry.name] = entry.sha256
                    downloadedBytes += dest.length()
                }
                if (!allOk) {
                    state = "error"
                    purgeModelFiles()
                    postModelEvent(JSONObject().put("state", "error").put("error", lastError), onModelEvent)
                    return@execute
                }
                saveLocalHashes(verifiedHashes)
                val memOk = hasEnoughMemory()
                val loadOk = memOk && TtsEngine.load(context, modelDir)
                if (loadOk) {
                    state = "ready"
                    progress = 100
                    postModelEvent(JSONObject().put("state", "ready"), onModelEvent)
                } else {
                    state = "error"
                    lastError = if (!memOk) "设备内存不足，无法加载语音模型" else "模型加载自检失败"
                    postModelEvent(JSONObject().put("state", "error").put("error", lastError), onModelEvent)
                }
            } catch (e: Exception) {
                state = "error"
                lastError = e.message ?: "模型下载异常"
                postModelEvent(JSONObject().put("state", "error").put("error", lastError), onModelEvent)
            }
        }
        return "downloading"
    }

    private data class ManifestEntry(val name: String, val sha256: String)

    // 从服务器获取模型清单（JSON 数组 [{name, sha256}]）
    private fun fetchManifest(url: String): List<ManifestEntry>? {
        return try {
            val text = ModelDownloader.readText(url) ?: return null
            if (text.isEmpty()) return null
            val arr = JSONArray(text)
            (0 until arr.length()).map { i ->
                val obj = arr.getJSONObject(i)
                ManifestEntry(obj.getString("name"), obj.getString("sha256"))
            }
        } catch (e: Exception) {
            android.util.Log.w("TtsModelManager", "获取模型清单失败: ${e.message}")
            null
        }
    }

    private fun readLocalHashes(): Map<String, String> {
        return try {
            if (!localHashFile.isFile) return emptyMap()
            val obj = JSONObject(localHashFile.readText())
            val result = mutableMapOf<String, String>()
            for (key in obj.keys()) {
                result[key] = obj.getString(key)
            }
            result
        } catch (_: Exception) {
            emptyMap()
        }
    }

    private fun saveLocalHashes(hashes: Map<String, String>) {
        try {
            val obj = JSONObject()
            for ((k, v) in hashes) obj.put(k, v)
            val tmp = File(localHashFile.parentFile, localHashFile.name + ".tmp")
            tmp.writeText(obj.toString())
            if (!tmp.renameTo(localHashFile)) {
                tmp.copyTo(localHashFile, overwrite = true)
                tmp.delete()
            }
        } catch (e: Exception) {
            android.util.Log.e("TtsModelManager", "保存 hash 记录失败: ${e.message}")
        }
    }

    private fun postModelEvent(json: JSONObject, onModelEvent: (JSONObject) -> Unit) {
        uiHandler.post { onModelEvent(json) }
    }

    // 低端机防 OOM：可用内存需 > 200MB（嵌入式 TTS 模型约 75MB + 引擎原生开销）
    private fun hasEnoughMemory(): Boolean {
        return try {
            val am = context.getSystemService(Context.ACTIVITY_SERVICE) as android.app.ActivityManager
            val mi = android.app.ActivityManager.MemoryInfo()
            am.getMemoryInfo(mi)
            mi.availMem > 200L * 1024 * 1024
        } catch (_: Exception) {
            true
        }
    }

    private fun purgeModelFiles() {
        TtsModelFiles.purge(modelDir)
        localHashFile.delete()
    }
}
