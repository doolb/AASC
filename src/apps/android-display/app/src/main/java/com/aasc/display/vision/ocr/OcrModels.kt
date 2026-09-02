package com.aasc.display.vision.ocr

/** OCR 结果模型只保存网页需要的数据；Bitmap 生命周期由 VisionRuntime 负责释放。 */
data class OcrPoint(val x: Float, val y: Float)

data class OcrBox(
    val text: String,
    val score: Float,
    val points: List<OcrPoint>
)

data class OcrTiming(
    val totalMs: Long,
    val affinityStatus: String
)

data class OcrResult(
    val text: String,
    val elapsedMs: Long,
    val imageWidth: Int,
    val imageHeight: Int,
    val boxes: List<OcrBox>,
    val affinityStatus: String
)

data class DecodedText(val text: String, val score: Float)
