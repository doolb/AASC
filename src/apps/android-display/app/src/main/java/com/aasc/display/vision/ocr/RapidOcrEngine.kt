package com.aasc.display.vision.ocr

import android.graphics.Bitmap
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import com.aasc.display.CpuAffinity
import com.aasc.display.CpuPolicy
import com.aasc.display.vision.VisionCpuPolicy
import java.io.File
import org.opencv.android.OpenCVLoader
import org.opencv.android.Utils
import org.opencv.core.Mat
import org.opencv.imgproc.Imgproc

/** RapidOCR 三模型串联引擎；实例只允许一个 recognize 调用同时运行。 */
class RapidOcrEngine {
    private var environment: OrtEnvironment? = null
    private var sessionOptions: OrtSession.SessionOptions? = null
    private var detectorSession: OrtSession? = null
    private var classifierSession: OrtSession? = null
    private var recognizerSession: OrtSession? = null
    private var dictionary: List<String> = emptyList()
    private var activeModelDir: File? = null
    private var activePolicy: CpuPolicy? = null
    private var affinityStatus = "未执行"

    val isLoaded: Boolean
        get() = detectorSession != null && classifierSession != null && recognizerSession != null

    val currentAffinityStatus: String
        get() = affinityStatus

    @Synchronized
    fun load(modelDir: File, policy: CpuPolicy) {
        require(com.aasc.display.vision.VisionModelFiles.isRapidOcrComplete(modelDir)) { "RapidOCR 模型文件不完整" }
        if (isLoaded && activeModelDir == modelDir && activePolicy == policy) {
            affinityStatus = applyAffinity(policy)
            return
        }
        releaseSessions()
        check(OpenCVLoader.initLocal()) { "OpenCV 初始化失败" }
        val newEnvironment = environment ?: OrtEnvironment.getEnvironment().also { environment = it }
        var newOptions: OrtSession.SessionOptions? = null
        var newDetector: OrtSession? = null
        var newClassifier: OrtSession? = null
        var newRecognizer: OrtSession? = null
        try {
            affinityStatus = applyAffinity(policy)
            newOptions = OrtSession.SessionOptions().apply {
                setIntraOpNumThreads(VisionCpuPolicy.ORT_INTRA_OP_THREADS)
                setInterOpNumThreads(VisionCpuPolicy.ORT_INTER_OP_THREADS)
                setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT)
            }
            newDetector = newEnvironment.createSession(modelDir.resolve(com.aasc.display.vision.VisionModelFiles.RAPID_OCR_FILE_NAMES[0]).absolutePath, newOptions)
            newClassifier = newEnvironment.createSession(modelDir.resolve(com.aasc.display.vision.VisionModelFiles.RAPID_OCR_FILE_NAMES[1]).absolutePath, newOptions)
            newRecognizer = newEnvironment.createSession(modelDir.resolve(com.aasc.display.vision.VisionModelFiles.RAPID_OCR_FILE_NAMES[2]).absolutePath, newOptions)
            val newDictionary = modelDir.resolve(com.aasc.display.vision.VisionModelFiles.RAPID_OCR_FILE_NAMES[3]).useLines { lines ->
                lines.map { it.removeSuffix("\r") }.toList()
            } + " "
            require(newDictionary.isNotEmpty()) { "RapidOCR 字典为空" }
            sessionOptions = newOptions
            detectorSession = newDetector
            classifierSession = newClassifier
            recognizerSession = newRecognizer
            dictionary = newDictionary
            activeModelDir = modelDir
            activePolicy = policy
        } catch (error: Exception) {
            newRecognizer?.close()
            newClassifier?.close()
            newDetector?.close()
            newOptions?.close()
            throw error
        }
    }

    @Synchronized
    fun recognize(bitmap: Bitmap, policy: CpuPolicy): OcrResult {
        check(isLoaded) { "RapidOCR 模型未就绪" }
        load(activeModelDir ?: error("RapidOCR 模型目录未记录"), policy)
        val start = System.nanoTime()
        val boxes = detect(bitmap)
        val recognized = boxes.mapNotNull { box -> recognizeBox(bitmap, box) }
        return OcrResult(
            text = recognized.joinToString("\n") { it.text },
            elapsedMs = (System.nanoTime() - start) / 1_000_000L,
            imageWidth = bitmap.width,
            imageHeight = bitmap.height,
            boxes = recognized,
            affinityStatus = affinityStatus
        )
    }

    @Synchronized
    fun release() {
        releaseSessions()
        // OrtEnvironment 是进程级共享资源，留给其他视觉引擎继续复用，不在单个引擎中关闭。
    }

    private fun releaseSessions() {
        recognizerSession?.close()
        classifierSession?.close()
        detectorSession?.close()
        sessionOptions?.close()
        recognizerSession = null
        classifierSession = null
        detectorSession = null
        sessionOptions = null
        dictionary = emptyList()
        activeModelDir = null
        activePolicy = null
    }

    private fun applyAffinity(policy: CpuPolicy): String {
        val applied = CpuAffinity.applyCurrentThread(policy.cpuMask)
        val cpu = policy.selectedCpus.joinToString(",")
        return if (applied) "单小核（核心 $cpu）" else "单小核（核心 $cpu，affinity 回退）"
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
            val runtime = environment ?: error("ONNX Runtime 未加载")
            val inputTensor = RapidOcrOrtUtils.createInput(runtime, input, longArrayOf(1, 3, resizedHeight.toLong(), resizedWidth.toLong()))
            try {
                session.run(mapOf(session.inputNames.first() to inputTensor)).use { result ->
                    val output = RapidOcrOrtUtils.readFloatTensor(result)
                    val outputHeight = output.shape.getOrNull(output.shape.lastIndex - 1)?.toInt()?.takeIf { it > 0 } ?: resizedHeight
                    val outputWidth = output.shape.lastOrNull()?.toInt()?.takeIf { it > 0 } ?: resizedWidth
                    DbPostProcessor.extractBoxes(output.values, outputWidth, outputHeight, bitmap.width, bitmap.height)
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
            val runtime = environment ?: error("ONNX Runtime 未加载")
            val classifier = classifierSession ?: error("方向分类模型未加载")
            val recognizer = recognizerSession ?: error("文字识别模型未加载")
            val classified = OrientationClassifier.correct(crop, classifier, runtime)
            if (classified !== crop) crop.recycle()
            corrected = classified
            val decoded = RecognitionDecoder.decode(corrected, recognizer, runtime, dictionary)
            if (decoded.text.trim().isEmpty()) null else OcrBox(decoded.text, decoded.score, box)
        } finally {
            corrected.recycle()
        }
    }

    private fun detectorScale(width: Int, height: Int): Float {
        val shortSide = minOf(width, height)
        return if (shortSide < DETECTOR_LIMIT) DETECTOR_LIMIT.toFloat() / shortSide else 1f
    }

    private fun roundTo32(value: Float): Int = (kotlin.math.round(value / 32f).toInt() * 32).coerceAtLeast(32)

    private companion object {
        const val DETECTOR_LIMIT = 736
    }
}
