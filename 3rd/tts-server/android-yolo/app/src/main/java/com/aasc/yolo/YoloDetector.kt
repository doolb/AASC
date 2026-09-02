package com.aasc.yolo

import android.graphics.Bitmap
import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import java.io.File
import java.util.concurrent.locks.ReentrantLock

/**
 * YOLO11 单模型推理引擎。始终只保留一个活动 session，模型切换前先关闭旧资源。
 */
class YoloDetector(private val modelDir: File) : AutoCloseable {
    private val environment = OrtEnvironment.getEnvironment()
    private var sessionOptions: OrtSession.SessionOptions? = null
    private var activeSession: OrtSession? = null
    private var activeModelValue: YoloModel? = null
    private var activeCpuMode: CpuMode? = null
    /**
     * 覆盖 HTTP 检测、测速和资源释放的完整生命周期，避免停止服务后旧任务与新任务交叉操作 ORT。
     * 使用可重入锁是因为一次检测内部还会调用 load/detectLoaded 等同步方法。
     */
    private val inferenceLock = ReentrantLock(true)

    val isReady: Boolean
        get() = YoloModelFiles.isComplete(modelDir)

    val activeModel: YoloModel?
        get() = activeModelValue

    @Synchronized
    fun load(model: YoloModel, cpuMode: CpuMode = CpuMode.AUTO): Long {
        if (activeModelValue == model && activeSession != null && activeCpuMode == cpuMode) return 0L
        require(isReady) { "YOLO11 模型文件未就绪" }
        // session 创建出的 ORT 工作线程继承当前线程的 affinity，先绑定再创建 session。
        CpuAffinity.apply(cpuMode)
        releaseActiveSession()
        val start = System.nanoTime()
        var newOptions: OrtSession.SessionOptions? = null
        var newSession: OrtSession? = null
        try {
            newOptions = OrtSession.SessionOptions().apply {
                setIntraOpNumThreads(cpuMode.intraOpThreads)
                setInterOpNumThreads(1)
                setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT)
            }
            newSession = environment.createSession(modelDir.resolve(model.fileName).absolutePath, newOptions)
            sessionOptions = newOptions
            activeSession = newSession
            activeModelValue = model
            activeCpuMode = cpuMode
            return (System.nanoTime() - start) / 1_000_000L
        } catch (error: Exception) {
            newSession?.close()
            newOptions?.close()
            activeModelValue = null
            throw error
        }
    }

    fun detect(bitmap: Bitmap, model: YoloModel, cpuMode: CpuMode): YoloResult = withInferenceLock {
        synchronized(this) {
            val loadModelMs = load(model, cpuMode)
            detectLoaded(bitmap, cpuMode).copy(loadModelMs = loadModelMs)
        }
    }

    @Synchronized
    fun detectLoaded(bitmap: Bitmap, cpuMode: CpuMode): YoloResult {
        val model = activeModelValue ?: error("YOLO11 模型未加载")
        val session = activeSession ?: error("YOLO11 ONNX session 未加载")
        val affinityStatus = CpuAffinity.apply(cpuMode)
        val preprocessStart = System.nanoTime()
        val prepared = YoloPreprocessor.prepare(bitmap)
        val preprocessMs = elapsedMilliseconds(preprocessStart)
        val environment = this.environment
        val input = YoloOrtUtils.createInput(
            environment,
            prepared.values,
            longArrayOf(1L, 3L, YoloPreprocessor.INPUT_SIZE.toLong(), YoloPreprocessor.INPUT_SIZE.toLong())
        )
        val inferenceStart = System.nanoTime()
        try {
            session.run(mapOf(session.inputNames.first() to input)).use { outputs ->
                val inferenceMs = elapsedMilliseconds(inferenceStart)
                val postprocessStart = System.nanoTime()
                val tensor = YoloOrtUtils.readFloatTensor(outputs)
                val detections = YoloPostprocessor.decode(
                    shape = tensor.shape,
                    values = tensor.values,
                    transform = prepared.transform,
                    confidenceThreshold = 0.25f,
                    iouThreshold = 0.45f
                )
                val postprocessMs = elapsedMilliseconds(postprocessStart)
                return YoloResult(
                    model = model,
                    detections = detections,
                    timing = YoloTiming(preprocessMs, inferenceMs, postprocessMs),
                    affinityStatus = affinityStatus
                )
            }
        } finally {
            input.close()
        }
    }

    override fun close() = withInferenceLock {
        synchronized(this) {
            releaseActiveSession()
            try {
                environment.close()
            } catch (_: Exception) {
                // ONNX Runtime 环境可能被其他组件复用，关闭异常不影响 Activity 退出。
            }
        }
    }

    /**
     * 供测速组件持有整轮锁；不能只依赖单个 detectLoaded 的 synchronized，
     * 否则模型切换之间仍可能插入新的 HTTP 检测。
     */
    internal fun <T> withInferenceLock(action: () -> T): T {
        inferenceLock.lock()
        return try {
            action()
        } finally {
            inferenceLock.unlock()
        }
    }

    private fun releaseActiveSession() {
        activeSession?.close()
        sessionOptions?.close()
        activeSession = null
        sessionOptions = null
        activeModelValue = null
        activeCpuMode = null
    }

    private fun elapsedMilliseconds(start: Long): Long = (System.nanoTime() - start) / 1_000_000L
}
