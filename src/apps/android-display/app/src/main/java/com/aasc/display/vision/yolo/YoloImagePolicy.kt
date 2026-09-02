package com.aasc.display.vision.yolo

/** 保留 YOLO 图片输入限制的独立命名，便于后续增加其他视觉模型时复用测试。 */
object YoloImagePolicy {
    const val MAX_BODY_BYTES = 20 * 1024 * 1024
    const val MAX_PIXELS = 12 * 1024 * 1024

    fun validatePixelCount(width: Int, height: Int) {
        require(width > 0 && height > 0) { "图片尺寸无效" }
        require(width.toLong() * height.toLong() <= MAX_PIXELS) { "图片像素不能超过 12 MP" }
    }
}
