package com.aasc.display.vision.yolo

import android.graphics.Bitmap
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import com.aasc.display.CpuAffinity
import com.aasc.display.CpuPolicy
import com.aasc.display.vision.VisionCpuPolicy
import java.io.File

/** YOLO11n 单模型推理引擎；只保留一个 session，复用正式 APK 的单小核策略。 */
class Yolo11nDetector {
    private val environment = OrtEnvironment.getEnvironment()
    private var sessionOptions: OrtSession.SessionOptions? = null
    private var activeSession: OrtSession? = null
    private var activeModel: File? = null
    private var activePolicy: CpuPolicy? = null
    private var affinityStatus = "未执行"

    val isLoaded: Boolean
        get() = activeSession != null

    val currentAffinityStatus: String
        get() = affinityStatus

    @Synchronized
    fun load(modelFile: File, policy: CpuPolicy): Long {
        require(modelFile.isFile && modelFile.length() > 0L) { "YOLO11n 模型文件未就绪" }
        if (activeSession != null && activeModel == modelFile && activePolicy == policy) {
            affinityStatus = applyAffinity(policy)
            return 0L
        }
        releaseSession()
        affinityStatus = applyAffinity(policy)
        val start = System.nanoTime()
        var newOptions: OrtSession.SessionOptions? = null
        var newSession: OrtSession? = null
        try {
            newOptions = OrtSession.SessionOptions().apply {
                setIntraOpNumThreads(VisionCpuPolicy.ORT_INTRA_OP_THREADS)
                setInterOpNumThreads(VisionCpuPolicy.ORT_INTER_OP_THREADS)
                setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT)
            }
            newSession = environment.createSession(modelFile.absolutePath, newOptions)
            sessionOptions = newOptions
            activeSession = newSession
            activeModel = modelFile
            activePolicy = policy
            return (System.nanoTime() - start) / 1_000_000L
        } catch (error: Exception) {
            newSession?.close()
            newOptions?.close()
            throw error
        }
    }

    @Synchronized
    fun detect(bitmap: Bitmap, modelFile: File, policy: CpuPolicy): YoloResult {
        val loadModelMs = load(modelFile, policy)
        val session = activeSession ?: error("YOLO11n ONNX session 未加载")
        affinityStatus = applyAffinity(policy)
        val preprocessStart = System.nanoTime()
        val prepared = YoloPreprocessor.prepare(bitmap)
        val preprocessMs = elapsedMilliseconds(preprocessStart)
        val input = YoloOrtUtils.createInput(environment, prepared.values, longArrayOf(1L, 3L, 640L, 640L))
        val inferenceStart = System.nanoTime()
        try {
            session.run(mapOf(session.inputNames.first() to input)).use { outputs ->
                val inferenceMs = elapsedMilliseconds(inferenceStart)
                val postprocessStart = System.nanoTime()
                val tensor = YoloOrtUtils.readFloatTensor(outputs)
                val detections = YoloPostprocessor.decode(tensor.shape, tensor.values, prepared.transform, 0.25f, 0.45f)
                val postprocessMs = elapsedMilliseconds(postprocessStart)
                return YoloResult("yolo11n", detections, YoloTiming(preprocessMs, inferenceMs, postprocessMs), affinityStatus, loadModelMs)
            }
        } finally {
            input.close()
        }
    }

    @Synchronized
    fun release() {
        releaseSession()
    }

    private fun releaseSession() {
        activeSession?.close()
        sessionOptions?.close()
        activeSession = null
        sessionOptions = null
        activeModel = null
        activePolicy = null
    }

    private fun applyAffinity(policy: CpuPolicy): String {
        val applied = CpuAffinity.applyCurrentThread(policy.cpuMask)
        val cpu = policy.selectedCpus.joinToString(",")
        return if (applied) "单小核（核心 $cpu）" else "单小核（核心 $cpu，affinity 回退）"
    }

    private fun elapsedMilliseconds(start: Long): Long = (System.nanoTime() - start) / 1_000_000L
}
