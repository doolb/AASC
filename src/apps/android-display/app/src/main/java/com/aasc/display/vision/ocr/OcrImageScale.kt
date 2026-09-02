package com.aasc.display.vision.ocr

import android.graphics.Bitmap
import kotlin.math.roundToInt

/** OCR 输入图片的尺寸策略。正数尺寸只作为短边上限，避免小图被无意义地放大。 */
data class OcrImageSize(val width: Int, val height: Int)

object OcrImageScale {
    const val AUTO_SHORT_SIDE = 0
    const val MIN_SHORT_SIDE = 256
    const val MAX_SHORT_SIDE = 2048

    /** 校验来自服务器或 NativeBridge 的短边参数，统一拦截异常内存请求。 */
    fun normalizeShortSide(value: Int): Int {
        require(value == AUTO_SHORT_SIDE || value in MIN_SHORT_SIDE..MAX_SHORT_SIDE) {
            "OCR 短边必须为 0 或 $MIN_SHORT_SIDE..$MAX_SHORT_SIDE 的整数"
        }
        return value
    }

    /** 计算按原图比例缩小后的尺寸；自动模式或无需缩小时返回 null。 */
    fun targetSize(width: Int, height: Int, shortSide: Int): OcrImageSize? {
        require(width > 0 && height > 0) { "OCR 图片尺寸无效" }
        val normalized = normalizeShortSide(shortSide)
        if (normalized == AUTO_SHORT_SIDE) return null

        val sourceShortSide = minOf(width, height)
        val targetShortSide = minOf(sourceShortSide, normalized)
        if (targetShortSide >= sourceShortSide) return null

        return if (width <= height) {
            OcrImageSize(
                width = targetShortSide,
                height = (height.toDouble() * targetShortSide / width).roundToInt().coerceAtLeast(1)
            )
        } else {
            OcrImageSize(
                width = (width.toDouble() * targetShortSide / height).roundToInt().coerceAtLeast(1),
                height = targetShortSide
            )
        }
    }

    /** 按 targetSize 计算结果创建工作 Bitmap；未启用缩放时直接复用原 Bitmap。 */
    fun resizeForInference(bitmap: Bitmap, shortSide: Int): Bitmap {
        val target = targetSize(bitmap.width, bitmap.height, shortSide) ?: return bitmap
        return Bitmap.createScaledBitmap(bitmap, target.width, target.height, true)
    }
}
