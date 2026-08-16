package com.aasc.display

import java.nio.ByteBuffer

// glReadPixels 原始像素 → ARGB int 数组（自底向上翻转为自顶向下 + 各格式归一化）
// 纯逻辑、无 Android 依赖，可 JVM 单测；输出每元素 0xAARRGGBB，供 Bitmap.setPixels 使用
object ComputePixels {

    fun toArgb(raw: ByteBuffer, format: ImageFormat, width: Int, height: Int): IntArray {
        val w = width
        val h = height
        val out = IntArray(w * h)
        raw.rewind()
        when (format) {
            ImageFormat.RGBA8, ImageFormat.RGBA8UI -> {
                val bytes = ByteArray(w * h * 4)
                raw.get(bytes)
                for (y in 0 until h) {
                    val srcRow = (h - 1 - y) * w * 4  // glReadPixels 自底向上 → 翻转行
                    for (x in 0 until w) {
                        val s = srcRow + x * 4
                        val r = bytes[s].toInt() and 0xFF
                        val g = bytes[s + 1].toInt() and 0xFF
                        val b = bytes[s + 2].toInt() and 0xFF
                        val a = bytes[s + 3].toInt() and 0xFF
                        out[y * w + x] = (a shl 24) or (r shl 16) or (g shl 8) or b
                    }
                }
            }
            ImageFormat.RGBA32F, ImageFormat.RGBA16F -> {
                val floats = FloatArray(w * h * 4)
                raw.asFloatBuffer().get(floats)
                for (y in 0 until h) {
                    val srcRow = (h - 1 - y) * w * 4
                    for (x in 0 until w) {
                        val s = srcRow + x * 4
                        val r = (floats[s].coerceIn(0f, 1f) * 255f).toInt()
                        val g = (floats[s + 1].coerceIn(0f, 1f) * 255f).toInt()
                        val b = (floats[s + 2].coerceIn(0f, 1f) * 255f).toInt()
                        val a = (floats[s + 3].coerceIn(0f, 1f) * 255f).toInt()
                        out[y * w + x] = (a shl 24) or (r shl 16) or (g shl 8) or b
                    }
                }
            }
            ImageFormat.R32F -> {
                val floats = FloatArray(w * h)
                raw.asFloatBuffer().get(floats)
                for (y in 0 until h) {
                    val srcRow = (h - 1 - y) * w
                    for (x in 0 until w) {
                        val v = (floats[srcRow + x].coerceIn(0f, 1f) * 255f).toInt()
                        out[y * w + x] = (0xFF shl 24) or (v shl 16) or (v shl 8) or v
                    }
                }
            }
            ImageFormat.RGBA32UI -> {
                val ints = IntArray(w * h * 4)
                raw.asIntBuffer().get(ints)
                for (y in 0 until h) {
                    val srcRow = (h - 1 - y) * w * 4
                    for (x in 0 until w) {
                        val s = srcRow + x * 4
                        val r = ints[s] and 0xFF
                        val g = ints[s + 1] and 0xFF
                        val b = ints[s + 2] and 0xFF
                        val a = ints[s + 3] and 0xFF
                        out[y * w + x] = (a shl 24) or (r shl 16) or (g shl 8) or b
                    }
                }
            }
        }
        return out
    }
}
