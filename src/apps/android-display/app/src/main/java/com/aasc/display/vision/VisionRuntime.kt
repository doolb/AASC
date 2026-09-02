package com.aasc.display.vision

import android.content.Context
import android.graphics.Bitmap
import com.aasc.display.CpuCluster
import com.aasc.display.vision.ocr.RapidOcrEngine
import com.aasc.display.vision.ocr.OcrImageScale
import com.aasc.display.vision.yolo.Yolo11nDetector
import com.aasc.display.vision.yolo.YoloModel
import java.io.File
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import org.json.JSONObject

/**
 * 正式 APK 的统一视觉执行器。OCR 和 YOLO11 共享一个 worker 与一个等待槽，
 * 只允许串行推理，避免视觉模型之间互相抢占小核和内存。
 */
class VisionRuntime(context: Context) {
    private val appContext = context.applicationContext
    private val policy = VisionCpuPolicy.defaultFor(CpuCluster.detect())
    private val rapidOcrDirectory = File(appContext.filesDir, "models/vision/rapidocr")
    private val yoloDirectory = File(appContext.filesDir, "models/vision/yolo11")
    private val modelManager = VisionModelManager(appContext)
    private val ocrEngine = RapidOcrEngine()
    private val yoloEngine = Yolo11nDetector()
    private val running = AtomicBoolean(false)
    private val executor = ThreadPoolExecutor(
        1,
        1,
        0L,
        TimeUnit.MILLISECONDS,
        ArrayBlockingQueue(1),
        ThreadPoolExecutor.AbortPolicy()
    )

    fun status(): JSONObject = JSONObject()
        .put("ok", true)
        .put("cpu", VisionJson.cpuPolicy(policy)
            .put("ortIntraOpThreads", VisionCpuPolicy.ORT_INTRA_OP_THREADS)
            .put("ortInterOpThreads", VisionCpuPolicy.ORT_INTER_OP_THREADS)
            .put("affinityDefault", "单小核"))
        .put("queueSize", executor.queue.size)
        .put("busy", running.get())
        .put("ocr", JSONObject()
            .put("modelReady", VisionModelFiles.isRapidOcrComplete(rapidOcrDirectory))
            .put("sessionLoaded", ocrEngine.isLoaded))
        .put("yolo11n", yoloStatus(YoloModel.N))
        .put("yoloModels", org.json.JSONArray().apply {
            YoloModel.values().forEach { put(it.id) }
        })

    fun submitOcr(requestId: String, encodedImage: String, callback: (JSONObject) -> Unit): JSONObject {
        return submitOcr(requestId, encodedImage, OcrImageScale.AUTO_SHORT_SIDE, callback)
    }

    fun submitOcr(
        requestId: String,
        encodedImage: String,
        shortSide: Int,
        callback: (JSONObject) -> Unit
    ): JSONObject {
        return submitOcr(requestId, encodedImage, shortSide, "", callback)
    }

    fun submitOcr(
        requestId: String,
        encodedImage: String,
        shortSide: Int,
        serverBaseUrl: String,
        callback: (JSONObject) -> Unit
    ): JSONObject {
        val normalizedShortSide = try {
            OcrImageScale.normalizeShortSide(shortSide)
        } catch (error: IllegalArgumentException) {
            return VisionJson.error(requestId, "ocr", error.message ?: "OCR 短边参数无效")
        }
        return submit("ocr", requestId, encodedImage, callback) { bitmap ->
            val install = modelManager.ensureRapidOcr(serverBaseUrl)
            if (install.changed) ocrEngine.release()
            val cpuPolicy = policy
            ocrEngine.load(install.directory, cpuPolicy)
            VisionJson.ocrResult(requestId, ocrEngine.recognize(bitmap, cpuPolicy, normalizedShortSide))
        }
    }

    fun submitYolo11n(requestId: String, encodedImage: String, callback: (JSONObject) -> Unit): JSONObject {
        return submitYolo11n(requestId, encodedImage, "", YoloModel.N.id, callback)
    }

    fun submitYolo11n(
        requestId: String,
        encodedImage: String,
        serverBaseUrl: String,
        modelId: String,
        callback: (JSONObject) -> Unit
    ): JSONObject {
        val model = try {
            YoloModel.fromId(modelId)
        } catch (error: IllegalArgumentException) {
            return VisionJson.error(requestId, "yolo11n", error.message ?: "YOLO 模型无效")
        }
        return submit("yolo11n", requestId, encodedImage, callback) { bitmap ->
            val install = modelManager.ensureYolo(model, serverBaseUrl)
            if (install.changed) yoloEngine.release()
            VisionJson.yoloResult(requestId, yoloEngine.detect(bitmap, install.file(model.fileName), policy, model.id))
        }
    }

    private fun yoloStatus(model: YoloModel): JSONObject {
        val modelDirectory = File(yoloDirectory, model.id)
        return JSONObject()
            .put("modelReady", VisionModelFiles.isYoloComplete(modelDirectory, model))
            .put("sessionLoaded", yoloEngine.isLoaded && yoloEngine.currentModelId == model.id)
    }

    private fun submit(
        kind: String,
        requestId: String,
        encodedImage: String,
        callback: (JSONObject) -> Unit,
        task: (Bitmap) -> JSONObject
    ): JSONObject {
        val completed = AtomicBoolean(false)
        try {
            executor.execute {
                running.set(true)
                var bitmap: Bitmap? = null
                try {
                    bitmap = VisionImageCodec.decode(encodedImage)
                    deliverOnce(completed, callback, task(bitmap))
                } catch (error: OutOfMemoryError) {
                    deliverOnce(completed, callback, VisionJson.error(requestId, kind, "视觉模型内存不足"))
                } catch (error: Exception) {
                    deliverOnce(completed, callback, VisionJson.error(requestId, kind, error.message ?: "视觉推理失败"))
                } finally {
                    bitmap?.recycle()
                    running.set(false)
                }
            }
            return VisionJson.accepted()
        } catch (_: RejectedExecutionException) {
            return VisionJson.busy(kind)
        }
    }

    private fun deliverOnce(completed: AtomicBoolean, callback: (JSONObject) -> Unit, result: JSONObject) {
        if (completed.compareAndSet(false, true)) callback(result)
    }
}
