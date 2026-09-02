package com.aasc.rapidocr

import android.graphics.Bitmap
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import java.io.File
import org.opencv.android.OpenCVLoader
import org.opencv.android.Utils
import org.opencv.core.Mat
import org.opencv.imgproc.Imgproc

/**
 * RapidOCR 三模型串联引擎。实例只允许一个 recognize 调用同时运行，
 * 这样 HTTP 层可以直接复用同一个模型会话而不额外复制大 Tensor。
 */
class RapidOcrEngine {
    @Volatile
    private var ready = false
    private var environment: OrtEnvironment? = null
    private var sessionOptions: OrtSession.SessionOptions? = null
    private var detectorSession: OrtSession? = null
    private var classifierSession: OrtSession? = null
    private var recognizerSession: OrtSession? = null
    private var dictionary: List<String> = emptyList()
    private var activeModelDir: File? = null
    private var activeCpuMode: CpuMode? = null
    private var sessionBoundToInferenceThread = false

    val isReady: Boolean
        get() = ready

    /** 校验资源后再初始化 OpenCV 和 ORT，避免缺模型时产生无用 native 资源。 */
    @Synchronized
    fun load(modelDir: File, cpuMode: CpuMode = CpuMode.AUTO) {
        require(RapidOcrModelFiles.isComplete(modelDir)) { "RapidOCR 模型文件不完整" }
        release()
        check(OpenCVLoader.initLocal()) { "OpenCV 初始化失败" }

        var newEnvironment: OrtEnvironment? = null
        var newOptions: OrtSession.SessionOptions? = null
        var newDetector: OrtSession? = null
        var newClassifier: OrtSession? = null
        var newRecognizer: OrtSession? = null
        try {
            newEnvironment = OrtEnvironment.getEnvironment()
            newOptions = OrtSession.SessionOptions().apply {
                setIntraOpNumThreads(cpuMode.intraOpThreads)
                setInterOpNumThreads(1)
                setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT)
            }
            newDetector = newEnvironment.createSession(modelDir.resolve(RapidOcrModelFiles.FILE_NAMES[0]).absolutePath, newOptions)
            newClassifier = newEnvironment.createSession(modelDir.resolve(RapidOcrModelFiles.FILE_NAMES[1]).absolutePath, newOptions)
            newRecognizer = newEnvironment.createSession(modelDir.resolve(RapidOcrModelFiles.FILE_NAMES[2]).absolutePath, newOptions)
            val newDictionary = modelDir.resolve(RapidOcrModelFiles.FILE_NAMES[3]).useLines { lines ->
                lines.map { it.removeSuffix("\r") }.toList()
            } + " "
            require(newDictionary.isNotEmpty()) { "RapidOCR 字典为空" }

            environment = newEnvironment
            sessionOptions = newOptions
            detectorSession = newDetector
            classifierSession = newClassifier
            recognizerSession = newRecognizer
            dictionary = newDictionary
            activeModelDir = modelDir
            activeCpuMode = cpuMode
            // 首次 load 通常发生在模型准备线程；第一次 HTTP 推理前要在真正的推理线程重建一次。
            sessionBoundToInferenceThread = false
            ready = true
        } catch (exception: Exception) {
            newRecognizer?.close()
            newClassifier?.close()
            newDetector?.close()
            newOptions?.close()
            newEnvironment?.close()
            throw exception
        }
    }

    /**
     * 执行一次完整 OCR。调用方仍然拥有传入 Bitmap，必须在外层 finally 中回收它。
     */
    @Synchronized
    fun recognize(bitmap: Bitmap, cpuMode: CpuMode = CpuMode.AUTO): OcrResult {
        check(ready) { "RapidOCR 模型未就绪" }
        ensureSessionForCpuMode(cpuMode)
        val start = System.nanoTime()
        val boxes = detect(bitmap)
        val recognized = boxes.mapNotNull { box -> recognizeBox(bitmap, box) }
        return OcrResult(
            text = recognized.joinToString("\n") { it.text },
            elapsedMs = (System.nanoTime() - start) / 1_000_000L,
            imageWidth = bitmap.width,
            imageHeight = bitmap.height,
            boxes = recognized
        )
    }

    /** 释放所有 ORT 会话和 OpenCV 之外的 Java/native 资源。 */
    @Synchronized
    fun release() {
        ready = false
        recognizerSession?.close()
        classifierSession?.close()
        detectorSession?.close()
        sessionOptions?.close()
        environment?.close()
        recognizerSession = null
        classifierSession = null
        detectorSession = null
        sessionOptions = null
        environment = null
        dictionary = emptyList()
        activeModelDir = null
        activeCpuMode = null
        sessionBoundToInferenceThread = false
    }

    /**
     * ORT 的线程数和线程池在 session 创建时确定，因此模式变化不能只重新设置 affinity。
     * 当前方法在 recognize 的同步锁内执行，重建期间不会与另一张图片并发使用旧 session。
     */
    private fun ensureSessionForCpuMode(cpuMode: CpuMode) {
        if (sessionBoundToInferenceThread && activeCpuMode == cpuMode) return
        val modelDir = activeModelDir ?: error("RapidOCR 模型目录未记录")
        load(modelDir, cpuMode)
        sessionBoundToInferenceThread = true
    }

    private fun detect(bitmap: Bitmap): List<List<OcrPoint>> {
        val source = Mat()
        val rgb = Mat()
        val resized = Mat()
        return try {
            Utils.bitmapToMat(bitmap, source)
            Imgproc.cvtColor(source, rgb, Imgproc.COLOR_RGBA2RGB)
            val ratio = detectorScale(bitmap.width, bitmap.height)
            val resizedWidth = roundTo32(bitmap.width * ratio)
            val resizedHeight = roundTo32(bitmap.height * ratio)
            Imgproc.resize(rgb, resized, org.opencv.core.Size(resizedWidth.toDouble(), resizedHeight.toDouble()))

            val rgbBytes = ByteArray(resizedWidth * resizedHeight * 3)
            resized.get(0, 0, rgbBytes)
            val input = OcrTensorPreprocessor.toNchwRgb(rgbBytes, resizedWidth, resizedHeight)
            val session = detectorSession ?: error("检测模型未加载")
            val environment = environment ?: error("ONNX Runtime 未加载")
            val inputTensor = RapidOcrOrtUtils.createInput(
                environment,
                input,
                longArrayOf(1, 3, resizedHeight.toLong(), resizedWidth.toLong())
            )
            try {
                session.run(mapOf(session.inputNames.first() to inputTensor)).use { result ->
                    val output = RapidOcrOrtUtils.readFloatTensor(result)
                    val outputHeight = output.shape.getOrNull(output.shape.lastIndex - 1)?.toInt()?.takeIf { it > 0 } ?: resizedHeight
                    val outputWidth = output.shape.lastOrNull()?.toInt()?.takeIf { it > 0 } ?: resizedWidth
                    DbPostProcessor.extractBoxes(
                        probabilityMap = output.values,
                        mapWidth = outputWidth,
                        mapHeight = outputHeight,
                        originalWidth = bitmap.width,
                        originalHeight = bitmap.height
                    )
                }
            } finally {
                inputTensor.close()
            }
        } finally {
            resized.release()
            rgb.release()
            source.release()
        }
    }

    private fun recognizeBox(bitmap: Bitmap, box: List<OcrPoint>): OcrBox? {
        val crop = PerspectiveCropper.crop(bitmap, box)
        var corrected = crop
        return try {
            val environment = environment ?: error("ONNX Runtime 未加载")
            val classifier = classifierSession ?: error("方向分类模型未加载")
            val recognizer = recognizerSession ?: error("文字识别模型未加载")
            val classified = OrientationClassifier.correct(crop, classifier, environment)
            if (classified !== crop) crop.recycle()
            corrected = classified
            val decoded = RecognitionDecoder.decode(corrected, recognizer, environment, dictionary)
            if (decoded.text.trim().isEmpty()) null else OcrBox(decoded.text, decoded.score, box)
        } finally {
            corrected.recycle()
        }
    }

    private fun detectorScale(width: Int, height: Int): Float {
        val shortSide = minOf(width, height)
        return if (shortSide < DETECTOR_LIMIT) DETECTOR_LIMIT.toFloat() / shortSide else 1f
    }

    private fun roundTo32(value: Float): Int =
        (kotlin.math.round(value / 32f).toInt() * 32).coerceAtLeast(32)

    private companion object {
        const val DETECTOR_LIMIT = 736
    }
}
