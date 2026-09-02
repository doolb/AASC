package com.aasc.display.vision.ocr

/** 将 RGB 像素转换为 RapidOCR 使用的 NCHW、[-1, 1] 浮点张量。 */
object OcrTensorPreprocessor {
    fun toNchw(pixels: IntArray, width: Int, height: Int): FloatArray {
        require(width > 0 && height > 0) { "图片宽高必须大于零" }
        require(pixels.size == width * height) { "像素数组长度与图片尺寸不一致" }
        val planeSize = width * height
        val tensor = FloatArray(planeSize * 3)
        pixels.forEachIndexed { index, pixel ->
            tensor[index] = normalize((pixel shr 16) and 0xff)
            tensor[planeSize + index] = normalize((pixel shr 8) and 0xff)
            tensor[planeSize * 2 + index] = normalize(pixel and 0xff)
        }
        return tensor
    }

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
