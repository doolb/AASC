package com.aasc.rapidocr

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import java.nio.FloatBuffer

/** ONNX Runtime 的小型适配层，统一 Tensor 创建、读取和 Bitmap 预处理。 */
internal object RapidOcrOrtUtils {
    data class FloatTensor(val shape: LongArray, val values: FloatArray)

    fun createInput(environment: OrtEnvironment, values: FloatArray, shape: LongArray): OnnxTensor =
        OnnxTensor.createTensor(environment, FloatBuffer.wrap(values), shape)

    fun readFloatTensor(result: OrtSession.Result, index: Int = 0): FloatTensor {
        val value = result.get(index)
        val tensor = value as? OnnxTensor ?: throw IllegalStateException("RapidOCR 输出不是浮点 Tensor")
        val buffer = tensor.floatBuffer
        buffer.rewind()
        val values = FloatArray(buffer.remaining())
        buffer.get(values)
        return FloatTensor(tensor.info.shape, values)
    }

    /** 将 Bitmap 缩放到目标高度并在右侧补零，输出 [1, 3, H, W]。 */
    fun bitmapToPaddedNchw(bitmap: android.graphics.Bitmap, targetHeight: Int, targetWidth: Int): FloatArray {
        require(targetHeight > 0 && targetWidth > 0) { "模型输入尺寸必须大于零" }
        val ratio = bitmap.width.toFloat() / bitmap.height.toFloat()
        val resizedWidth = kotlin.math.ceil(targetHeight * ratio).toInt().coerceIn(1, targetWidth)
        val scaled = android.graphics.Bitmap.createScaledBitmap(bitmap, resizedWidth, targetHeight, true)
        return try {
            val pixels = IntArray(resizedWidth * targetHeight)
            scaled.getPixels(pixels, 0, resizedWidth, 0, 0, resizedWidth, targetHeight)
            val resizedTensor = OcrTensorPreprocessor.toNchw(pixels, resizedWidth, targetHeight)
            val padded = FloatArray(targetHeight * targetWidth * 3)
            val resizedPlane = resizedWidth * targetHeight
            val targetPlane = targetHeight * targetWidth
            (0 until 3).forEach { channel ->
                (0 until targetHeight).forEach { row ->
                    val sourceOffset = channel * resizedPlane + row * resizedWidth
                    val targetOffset = channel * targetPlane + row * targetWidth
                    resizedTensor.copyInto(padded, targetOffset, sourceOffset, sourceOffset + resizedWidth)
                }
            }
            padded
        } finally {
            if (scaled !== bitmap) scaled.recycle()
        }
    }
}
