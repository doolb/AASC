package com.aasc.display.vision

import java.io.File
import com.aasc.display.vision.yolo.YoloModel

/** 统一管理正式 APK 视觉模型缓存，不从 APK assets 读取模型。 */
object VisionModelFiles {
    val RAPID_OCR_FILE_NAMES = listOf(
        "PP-OCRv6_det_small.onnx",
        "ch_ppocr_mobile_v2.0_cls_mobile.onnx",
        "PP-OCRv6_rec_small.onnx",
        "ppocrv6_dict.txt"
    )
    val YOLO_FILE_NAMES = YoloModel.values().map { it.fileName }

    fun isRapidOcrComplete(modelDir: File): Boolean = isComplete(modelDir, RAPID_OCR_FILE_NAMES)

    fun isYoloComplete(modelDir: File): Boolean = isYoloComplete(modelDir, YoloModel.N)

    fun isYoloComplete(modelDir: File, model: YoloModel): Boolean =
        isComplete(modelDir, listOf(model.fileName))

    private fun isComplete(modelDir: File, fileNames: List<String>): Boolean {
        return modelDir.isDirectory && fileNames.all { name ->
            val file = File(modelDir, name)
            file.isFile && file.length() > 0L
        }
    }

}
