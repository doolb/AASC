package com.aasc.rapidocr

import android.graphics.Bitmap

// OCR 结果模型只保存 HTTP 和网页需要的数据；Bitmap 的生命周期由请求处理方负责释放。
data class OcrPoint(val x: Float, val y: Float)

data class OcrBox(
    val text: String,
    val score: Float,
    val points: List<OcrPoint>
)

data class OcrResult(
    val text: String,
    val elapsedMs: Long,
    val imageWidth: Int,
    val imageHeight: Int,
    val boxes: List<OcrBox>
)

// 图片策略同时返回 Bitmap 和最终方向后的尺寸，调用方必须在使用结束后 recycle Bitmap。
data class DecodedImage(val bitmap: Bitmap)

data class DecodedText(val text: String, val score: Float)
