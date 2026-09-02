package com.aasc.display.vision

import android.content.Context
import android.graphics.Bitmap
import com.aasc.display.CpuCluster
import com.aasc.display.vision.ocr.RapidOcrEngine
import com.aasc.display.vision.yolo.Yolo11nDetector
import java.io.File
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import org.json.JSONObject

/**
 * 正式 APK 的统一视觉执行器。OCR 和 YOLO11n 共享一个 worker 与一个等待槽，
 * 只允许串行推理，避免视觉模型之间互相抢占小核和内存。
 */
class VisionRuntime(context: Context) {
    private val appContext = context.applicationContext
    private val policy = VisionCpuPolicy.defaultFor(CpuCluster.detect())
    private val rapidOcrDirectory = File(appContext.filesDir, "models/vision/rapidocr")
    private val yoloDirectory = File(appContext.filesDir, "models/vision/yolo11")
    private val yoloModelFile = File(yoloDirectory, "yolo11n.onnx")
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
        .put("yolo11n", JSONObject()
            .put("modelReady", VisionModelFiles.isYoloComplete(yoloDirectory))
            .put("sessionLoaded", yoloEngine.isLoaded))

    fun submitOcr(requestId: String, encodedImage: String, callback: (JSONObject) -> Unit): JSONObject {
        return submit("ocr", requestId, encodedImage, callback) { bitmap ->
            VisionModelFiles.ensureRapidOcrCopied(appContext.assets, rapidOcrDirectory)
            val cpuPolicy = policy
            if (!ocrEngine.isLoaded) ocrEngine.load(rapidOcrDirectory, cpuPolicy)
            VisionJson.ocrResult(requestId, ocrEngine.recognize(bitmap, cpuPolicy))
        }
    }

    fun submitYolo11n(requestId: String, encodedImage: String, callback: (JSONObject) -> Unit): JSONObject {
        return submit("yolo11n", requestId, encodedImage, callback) { bitmap ->
            VisionModelFiles.ensureYoloCopied(appContext.assets, yoloDirectory)
            VisionJson.yoloResult(requestId, yoloEngine.detect(bitmap, yoloModelFile, policy))
        }
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
