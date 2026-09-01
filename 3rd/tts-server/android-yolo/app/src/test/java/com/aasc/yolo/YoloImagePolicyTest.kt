package com.aasc.yolo

import org.junit.Assert.assertThrows
import org.junit.Test

/** 图片边界测试，确保像素上限在 Bitmap 实际分配前即可被复用校验。 */
class YoloImagePolicyTest {
    @Test
    fun acceptsImageWithinPixelLimit() {
        YoloImagePolicy.validatePixelCount(4000, 3000)
    }

    @Test
    fun rejectsImageAbovePixelLimit() {
        assertThrows(IllegalArgumentException::class.java) {
            YoloImagePolicy.validatePixelCount(4096, 4096)
        }
    }
}
