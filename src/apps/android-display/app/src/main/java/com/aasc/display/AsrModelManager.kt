package com.aasc.display

import android.content.Context
import android.os.Handler
import android.os.Looper
import org.json.JSONObject
import java.io.File
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

// 原生 ASR 模型管理：下载/校验/加载/状态机
// 状态：not_ready → downloading → ready | error（error 或损坏后再次 ensureModel 会重新下载）
class AsrModelManager(
    private val context: Context,
    private val uiHandler: Handler = Handler(Looper.getMainLooper())
) {
    private val modelDir = File(context.filesDir, "models/sensevoice")
    private val modelFile = File(modelDir, "model.int8.onnx")
    private val tokensFile = File(modelDir, "tokens.txt")
    private val modelHashFile = File(modelDir, "model.int8.onnx.sha256")
    private val tokensHashFile = File(modelDir, "tokens.txt.sha256")
    private val downloadPool: ExecutorService = Executors.newSingleThreadExecutor()
    private val lock = Any()

    @Volatile var state: String = "not_ready"
        private set
    @Volatile var progress: Int = 0
        private set
    @Volatile var lastError: String = ""
        private set

    val isReady: Boolean get() = state == "ready"

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
        // 下载状态一旦建立就立即通知 WebView，避免 tokens 下载、网络连接或首个模型数据块到达前界面无提示。
        postModelEvent(JSONObject().put("state", "downloading").put("progress", 0), onModelEvent)
        downloadPool.execute {
            try {
                modelDir.mkdirs()
                val modelUrl = "$baseUrl/api/asr/model/model.int8.onnx"
                val tokensUrl = "$baseUrl/api/asr/model/tokens.txt"
                val modelHashUrl = "$baseUrl/api/asr/model/model.int8.onnx.sha256"
                val tokensHashUrl = "$baseUrl/api/asr/model/tokens.txt.sha256"
                val serverHashes = readServerHashes(modelHashUrl, tokensHashUrl)
                // 重启时只比较本地保存 hash 与服务器 hash，不重新读取 234MB 模型计算 hash。
                // 服务器暂时不可达时，已有模型+本地 hash 代表上次已验证结果，可继续使用。
                val validOnDisk = hasVerifiedLocalFiles(serverHashes)
                // 没有已验证缓存时必须先拿到服务器 hash，禁止无校验下载模型。
                val okTokens = validOnDisk || (serverHashes != null && downloadFile(tokensUrl, tokensFile, serverHashes.tokens) { /* tokens 很小，不细分进度 */ })
                // okTokens 短路：tokens 下载或 hash 校验失败时不再拉取 234MB 大模型。
                val okModel = validOnDisk || (serverHashes != null && okTokens && downloadFile(modelUrl, modelFile, serverHashes.model) { p ->
                    progress = p
                    postModelEvent(JSONObject().put("state", "downloading").put("progress", p), onModelEvent)
                })
                val hashSaved = validOnDisk || (okModel && serverHashes != null && saveLocalHashes(serverHashes))
                // AsrEngine 默认按核心数创建 recognizer；内存不足时内部回退到单实例。
                // 只有连单实例也无法创建时才返回内存错误，避免反复触发 WebSocket 重连。
                val loadOk = if (okModel && hashSaved) {
                    AsrEngine.load(context, modelFile, tokensFile)
                } else {
                    false
                }
                val loadMemoryError = !loadOk && okModel && hashSaved && AsrEngine.lastLoadWasMemoryError
                if (loadOk) {
                    state = "ready"
                    postModelEvent(JSONObject().put("state", "ready"), onModelEvent)
                } else {
                    state = "error"
                    lastError = when {
                        !validOnDisk && serverHashes == null -> "无法获取模型校验 hash"
                        !okModel -> "模型下载失败"
                        !hashSaved -> "模型 hash 保存失败"
                        loadMemoryError -> "设备内存不足，无法加载语音模型"
                        else -> "模型加载自检失败"
                    }
                    when {
                        // 下载或 hash 校验失败：模型/tokens/hash 全部清掉（含 .tmp 残件）
                        !okModel || !hashSaved -> purgeModelFiles()
                        // 内存不足：保留已下载文件（内存释放后可重试加载），仅清理 .tmp 残件
                        loadMemoryError -> {
                            File(modelFile.parentFile, modelFile.name + ".tmp").delete()
                            File(tokensFile.parentFile, tokensFile.name + ".tmp").delete()
                        }
                        // 加载自检失败：清掉损坏文件（含 .tmp 残件）
                        else -> purgeModelFiles()
                    }
                    postModelEvent(JSONObject().put("state", "error").put("error", lastError), onModelEvent)
                }
            } catch (e: OutOfMemoryError) {
                state = "error"
                lastError = "设备内存不足，无法加载语音模型"
                postModelEvent(JSONObject().put("state", "error").put("error", lastError), onModelEvent)
            } catch (e: Exception) {
                state = "error"
                lastError = e.message ?: "模型下载异常"
                postModelEvent(JSONObject().put("state", "error").put("error", lastError), onModelEvent)
            }
        }
        return "downloading"
    }

    private fun postModelEvent(json: JSONObject, onModelEvent: (JSONObject) -> Unit) {
        uiHandler.post { onModelEvent(json) }
    }

    // 下载委托共享 ModelDownloader（SSL-trust 自签名证书 + .tmp 原子改名逻辑已抽离，见 ModelDownloader.kt）
    private fun downloadFile(urlStr: String, dest: File, onProgress: (Int) -> Unit): Boolean =
        ModelDownloader.download(urlStr, dest, onProgress)

    private fun downloadFile(urlStr: String, dest: File, expectedHash: String, onProgress: (Int) -> Unit): Boolean =
        ModelDownloader.download(urlStr, dest, expectedHash, onProgress)

    private data class ServerHashes(val model: String, val tokens: String)

    private fun readServerHashes(modelUrl: String, tokensUrl: String): ServerHashes? {
        val modelHash = ModelDownloader.readText(modelUrl) ?: return null
        val tokensHash = ModelDownloader.readText(tokensUrl) ?: return null
        return ServerHashes(modelHash, tokensHash)
    }

    private fun hasVerifiedLocalFiles(serverHashes: ServerHashes?): Boolean {
        if (!modelFile.isFile || !tokensFile.isFile || !modelHashFile.isFile || !tokensHashFile.isFile) return false
        if (serverHashes == null) return true
        return ModelHash.normalize(modelHashFile.readText()) == ModelHash.normalize(serverHashes.model) &&
            ModelHash.normalize(tokensHashFile.readText()) == ModelHash.normalize(serverHashes.tokens)
    }

    private fun saveLocalHashes(serverHashes: ServerHashes): Boolean = try {
        writeHashFile(modelHashFile, serverHashes.model)
        writeHashFile(tokensHashFile, serverHashes.tokens)
        true
    } catch (e: Exception) {
        android.util.Log.e("AsrModelManager", "保存模型 hash 失败: ${e.message}")
        false
    }

    private fun writeHashFile(dest: File, content: String) {
        val tmp = File(dest.parentFile, dest.name + ".tmp")
        tmp.writeText(ModelHash.normalize(content) + "\n")
        if (!tmp.renameTo(dest)) {
            tmp.copyTo(dest, overwrite = true)
            tmp.delete()
        }
    }

    private fun purgeModelFiles() {
        AsrModelFiles.purge(modelFile, tokensFile)
        modelHashFile.delete()
        tokensHashFile.delete()
        File(modelHashFile.parentFile, modelHashFile.name + ".tmp").delete()
        File(tokensHashFile.parentFile, tokensHashFile.name + ".tmp").delete()
    }
}
