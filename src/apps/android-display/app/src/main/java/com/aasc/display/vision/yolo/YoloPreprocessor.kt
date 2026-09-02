package com.aasc.display.vision.yolo

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Rect
import kotlin.math.roundToInt

data class LetterboxTransform(
    val sourceWidth: Int,
    val sourceHeight: Int,
    val scale: Float,
    val resizedWidth: Int,
    val resizedHeight: Int,
    val padLeft: Float,
    val padTop: Float
)

data class PreparedInput(val values: FloatArray, val transform: LetterboxTransform)

/** 将图片转换为 YOLO11 固定的 640x640 RGB NCHW 输入。 */
object YoloPreprocessor {
    const val INPUT_SIZE = 640
    private const val PAD_VALUE = 114

    fun calculateTransform(sourceWidth: Int, sourceHeight: Int): LetterboxTransform {
        require(sourceWidth > 0 && sourceHeight > 0) { "图片尺寸必须大于零" }
        val scale = minOf(INPUT_SIZE.toFloat() / sourceWidth, INPUT_SIZE.toFloat() / sourceHeight)
        val resizedWidth = (sourceWidth * scale).roundToInt().coerceIn(1, INPUT_SIZE)
        val resizedHeight = (sourceHeight * scale).roundToInt().coerceIn(1, INPUT_SIZE)
        return LetterboxTransform(sourceWidth, sourceHeight, scale, resizedWidth, resizedHeight,
            (INPUT_SIZE - resizedWidth) / 2f, (INPUT_SIZE - resizedHeight) / 2f)
    }

    fun prepare(bitmap: Bitmap): PreparedInput {
        val transform = calculateTransform(bitmap.width, bitmap.height)
        val canvasBitmap = Bitmap.createBitmap(INPUT_SIZE, INPUT_SIZE, Bitmap.Config.ARGB_8888)
        return try {
            Canvas(canvasBitmap).apply {
                drawColor(Color.rgb(PAD_VALUE, PAD_VALUE, PAD_VALUE))
                drawBitmap(
                    bitmap,
                    null,
                    Rect(transform.padLeft.toInt(), transform.padTop.toInt(),
                        transform.padLeft.toInt() + transform.resizedWidth,
                        transform.padTop.toInt() + transform.resizedHeight),
                    Paint(Paint.FILTER_BITMAP_FLAG)
                )
            }
            val pixels = IntArray(INPUT_SIZE * INPUT_SIZE)
            canvasBitmap.getPixels(pixels, 0, INPUT_SIZE, 0, 0, INPUT_SIZE, INPUT_SIZE)
            PreparedInput(toNchw(pixels, INPUT_SIZE, INPUT_SIZE), transform)
        } finally {
            canvasBitmap.recycle()
        }
    }

    fun toNchw(pixels: IntArray, width: Int, height: Int): FloatArray {
        require(pixels.size == width * height) { "像素数组尺寸不匹配" }
        val planeSize = width * height
        val output = FloatArray(planeSize * 3)
        pixels.forEachIndexed { index, pixel ->
            output[index] = ((pixel ushr 16) and 0xff) / 255f
            output[planeSize + index] = ((pixel ushr 8) and 0xff) / 255f
            output[planeSize * 2 + index] = (pixel and 0xff) / 255f
        }
        return output
    }
}
