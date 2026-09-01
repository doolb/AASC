package com.aasc.rapidocr

/**
 * 将 ARGB 像素转换为 RapidOCR 使用的 RGB、NCHW、[-1, 1] 浮点张量。
 * 该类只依赖基础数组，方便在 JVM 单元测试中验证通道顺序和归一化结果。
 */
object OcrTensorPreprocessor {
    fun toNchw(pixels: IntArray, width: Int, height: Int): FloatArray {
        require(width > 0 && height > 0) { "图片宽高必须大于零" }
        require(pixels.size == width * height) { "像素数组长度与图片尺寸不一致" }

        val planeSize = width * height
        val tensor = FloatArray(planeSize * 3)
        pixels.forEachIndexed { index, pixel ->
            val red = (pixel shr 16) and 0xff
            val green = (pixel shr 8) and 0xff
            val blue = pixel and 0xff
            tensor[index] = normalize(red)
            tensor[planeSize + index] = normalize(green)
            tensor[planeSize * 2 + index] = normalize(blue)
        }
        return tensor
    }

    /** 将 OpenCV 的连续 RGB 字节流转换为同样布局的 NCHW 张量。 */
    fun toNchwRgb(rgbBytes: ByteArray, width: Int, height: Int): FloatArray {
        require(width > 0 && height > 0) { "图片宽高必须大于零" }
        require(rgbBytes.size == width * height * 3) { "RGB 字节数组长度与图片尺寸不一致" }

        val planeSize = width * height
        val tensor = FloatArray(planeSize * 3)
        rgbBytes.forEachIndexed { index, value ->
            val pixelIndex = index / 3
            val channel = index % 3
            tensor[channel * planeSize + pixelIndex] = normalize(value.toInt() and 0xff)
        }
        return tensor
    }

    private fun normalize(value: Int): Float = value / 127.5f - 1f
}
