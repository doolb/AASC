package com.aasc.display

import android.content.Context
import android.os.Handler
import android.os.Looper
import org.json.JSONObject
import java.io.File
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

// 声纹模型管理：embedding（必下）+ segmentation（multiSpeaker 才下），复用 ModelDownloader
class VoiceprintModelManager(
    private val context: Context,
    private val uiHandler: Handler = Handler(Looper.getMainLooper())
) {
    private val modelDir = File(context.filesDir, "models/voiceprint")
    val embeddingFile = File(modelDir, "3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx")
    val segmentationFile = File(modelDir, "pyannote_segmentation_3_0_int8.onnx")
    private val downloadPool: ExecutorService = Executors.newSingleThreadExecutor()
    private val lock = Any()

    @Volatile var state: String = "not_ready"; private set
    @Volatile var progress: Int = 0; private set
    @Volatile var lastError: String = ""; private set

    val isReady: Boolean get() = state == "ready"
    val embeddingModelPath: String get() = embeddingFile.absolutePath
    val segmentationModelPath: String get() = segmentationFile.absolutePath

    fun statusJson(): JSONObject = JSONObject()
        .put("state", state).put("progress", progress).put("error", lastError)

    // 幂等触发：ready→"ready"；downloading→"downloading"；否则下载（embedding 必下，segmentation 按 needSegmentation）
    fun ensureModel(baseUrl: String, needSegmentation: Boolean, onModelEvent: (JSONObject) -> Unit): String {
        synchronized(lock) {
            if (state == "ready") return "ready"
            if (state == "downloading") return "downloading"
            state = "downloading"; progress = 0; lastError = ""
        }
        downloadPool.execute {
            try {
                modelDir.mkdirs()
                // 磁盘已有完整模型则跳过下载（下载一次即可，重启不重复拉取）
                val embeddingOk = embeddingFile.isFile && embeddingFile.length() > 5L * 1024 * 1024
                val segOk = !needSegmentation || (segmentationFile.isFile && segmentationFile.length() > 500 * 1024)
                val okEmbedding = embeddingOk || ModelDownloader.download(
                    "$baseUrl/api/voiceprint/model/${embeddingFile.name}", embeddingFile) { p ->
                    progress = p
                    postModelEvent(JSONObject().put("state", "downloading").put("progress", p), onModelEvent)
                }
                val okSegmentation = segOk || ModelDownloader.download(
                    "$baseUrl/api/voiceprint/model/${segmentationFile.name}", segmentationFile) { }
                if (okEmbedding && okSegmentation) {
                    state = "ready"
                    postModelEvent(JSONObject().put("state", "ready"), onModelEvent)
                } else {
                    state = "error"
                    lastError = if (okEmbedding) "分割模型下载失败" else "声纹模型下载失败"
                    postModelEvent(JSONObject().put("state", "error").put("error", lastError), onModelEvent)
                }
            } catch (e: Exception) {
                state = "error"; lastError = e.message ?: "声纹模型下载异常"
                postModelEvent(JSONObject().put("state", "error").put("error", lastError), onModelEvent)
            }
        }
        return "downloading"
    }

    private fun postModelEvent(json: JSONObject, onModelEvent: (JSONObject) -> Unit) {
        uiHandler.post { onModelEvent(json) }
    }
}
